const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { Kafka } = require('kafkajs');
const TaskLog = require('./models/TaskLog');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

// ── JWT Middleware ─────────────────────────────────────────────
const verifyToken = (req, res, next) => {
  let token;
  if (req.cookies.habitToken) token = req.cookies.habitToken;
  else if (req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey_change_me_in_prod');
    req.user = { _id: decoded.id };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ── Kafka Setup ────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'tasks-service',
  brokers: [(process.env.KAFKA_BROKER || 'kafka:9092')],
  retry: { retries: 5, initialRetryTime: 300 }
});
const producer = kafka.producer();

async function connectKafka() {
  try {
    await producer.connect();
    console.log('[Tasks Service] Kafka Producer connected');
  } catch (err) {
    console.error('[Tasks Service] Kafka connection error:', err.message);
  }
}

// ── Cron Job for Notifications ─────────────────────────────────
// Run every minute to check for pending tasks
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    // Use local time for date string to match frontend 'yyyy-MM-dd'
    const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    const currentHourMin = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Find all logs for today
    const logs = await TaskLog.find({ date: todayStr });

    for (const log of logs) {
      let updated = false;
      for (const task of log.tasks) {
        if (
          task.status === 'Pending' &&
          task.notificationEnabled &&
          !task.notificationSent &&
          task.time <= currentHourMin
        ) {
          // Trigger Notification
          task.notificationSent = true;
          updated = true;

          const payload = {
            userId: log.userId,
            taskId: task.id,
            title: task.title,
            time: task.time,
            type: 'task-reminder',
            timestamp: new Date()
          };

          try {
            await producer.send({
              topic: 'task-notifications',
              messages: [{ key: log.userId, value: JSON.stringify(payload) }]
            });
            console.log(`[Tasks Service] Notification sent for task ${task.id}`);
          } catch (kafkaErr) {
            console.error('[Tasks Service] Kafka send failed:', kafkaErr.message);
            // Revert so it tries again next minute
            task.notificationSent = false;
            updated = false;
          }
        }
      }
      if (updated) {
        await log.save();
      }
    }
  } catch (err) {
    console.error('[Tasks Service] Cron job error:', err.message);
  }
});

// ── API Routes ─────────────────────────────────────────────────
app.get('/api/tasks', verifyToken, async (req, res) => {
  try {
    const logs = await TaskLog.find({ userId: req.user._id });
    res.json(logs);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/tasks/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let log = await TaskLog.findOne({ userId: req.user._id, date });
    res.json(log || { date, tasks: [] });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/tasks/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let { tasks } = req.body;
    
    // In case aggregator passes the whole block instead of extracting 'tasks'
    if (!tasks && Array.isArray(req.body)) {
        tasks = req.body;
    }

    let log = await TaskLog.findOne({ userId: req.user._id, date });
    if (log) {
      log.tasks = tasks || [];
      await log.save();
    } else {
      log = await TaskLog.create({ userId: req.user._id, date, tasks: tasks || [] });
    }
    res.json(log);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/tasks/action', verifyToken, async (req, res) => {
  try {
    const { taskId, action } = req.body;
    const userId = req.user._id;

    // Find the task log that contains this task ID for this user
    const log = await TaskLog.findOne({ userId, 'tasks.id': taskId });
    if (!log) return res.status(404).json({ message: 'Task not found' });

    const taskIndex = log.tasks.findIndex(t => t.id === taskId);
    const task = log.tasks[taskIndex];

    if (action === 'complete') {
      task.status = 'Completed';
    } else if (action === 'snooze') {
      // Add 10 minutes to current time
      const [h, m] = task.time.split(':').map(Number);
      let newM = m + 10;
      let newH = h;
      if (newM >= 60) {
        newM -= 60;
        newH = (newH + 1) % 24;
      }
      task.time = `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
      task.notificationSent = false;
    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    await log.save();
    res.json({ message: `Task ${action} successfully`, task });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));


// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5131;

connectDB('Tasks Service').then(() => {
  connectKafka();
  app.listen(PORT, () => console.log(`[Tasks Service] Running on port ${PORT}`));
});
