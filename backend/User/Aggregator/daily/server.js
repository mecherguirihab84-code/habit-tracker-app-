const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const DailyLog = require('./models/DailyLog');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

const verifyToken = (req, res, next) => {
  let token;
  if (req.cookies.habitToken) token = req.cookies.habitToken;
  else if (req.headers.authorization?.startsWith('Bearer')) token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey_change_me_in_prod');
    req.user = { _id: decoded.id };
    next();
  } catch (error) { res.status(401).json({ message: 'Invalid token' }); }
};

const SERVICES = {
  morning: process.env.MORNING_SERVICE_URL || 'http://morning-habits:5118',
  bad: process.env.BAD_SERVICE_URL || 'http://bad-habits:5119',
  night: process.env.NIGHT_SERVICE_URL || 'http://night-habits:5120',
  weekend: process.env.WEEKEND_SERVICE_URL || 'http://weekend-duties:5121',
  hustle: process.env.HUSTLE_SERVICE_URL || 'http://side-hustle:5122',
  video: process.env.VIDEO_SERVICE_URL || 'http://video-editing:5123',
  books: process.env.BOOK_LOG_SERVICE_URL || 'http://book-reading:5124',
  system: process.env.SYSTEM_SERVICE_URL || 'http://system-check:5125',
  expenses: process.env.EXPENSES_SERVICE_URL || 'http://expenses:5126',
  tasks: process.env.TASKS_SERVICE_URL || 'http://tasks-service:5131'
};

app.get('/api/daily', verifyToken, async (req, res) => {
  try {
    // 1. Get the "Authority" data from our own DB (contains scores, meta, etc)
    const storedLogs = await DailyLog.find({ userId: req.user._id });
    const logsByDate = {};
    
    storedLogs.forEach(log => {
      logsByDate[log.date] = log.data;
    });

    // 2. Fetch fresh sub-service data to ensure specific items are up to date
    const authHeader = req.headers.authorization || `Bearer ${req.cookies.habitToken}`;
    const results = await Promise.allSettled(
      Object.entries(SERVICES).map(([key, url]) => {
        const endpoint = key === 'books' ? 'book-log' : key;
        return axios.get(`${url}/api/${endpoint}`, {
          headers: { Authorization: authHeader },
          withCredentials: true
        });
      })
    );

    // 3. Merge sub-service data over our stored logs
    results.forEach((result, i) => {
      const key = Object.keys(SERVICES)[i];
      if (result.status === 'fulfilled') {
        const items = result.value.data;
        items.forEach(item => {
          if (!logsByDate[item.date]) logsByDate[item.date] = { date: item.date };
          // If expenses or tasks, we want just the array
          if (key === 'expenses' && item.expenses) {
            logsByDate[item.date][key] = item.expenses;
          } else if (key === 'tasks' && item.tasks) {
            logsByDate[item.date][key] = item.tasks;
          } else {
            logsByDate[item.date][key] = item;
          }
        });
      }
    });

    res.json(logsByDate);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/daily/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    
    // Get stored log first
    let logDoc = await DailyLog.findOne({ userId: req.user._id, date });
    let fullLog = logDoc ? logDoc.data : { date };

    // Overlay sub-service data
    const authHeader = req.headers.authorization || `Bearer ${req.cookies.habitToken}`;
    const results = await Promise.allSettled(
      Object.entries(SERVICES).map(([key, url]) => {
        const endpoint = key === 'books' ? 'book-log' : key;
        return axios.get(`${url}/api/${endpoint}/${date}`, {
          headers: { Authorization: authHeader },
          withCredentials: true
        });
      })
    );

    results.forEach((result, i) => {
      const key = Object.keys(SERVICES)[i];
      if (result.status === 'fulfilled') {
        const item = result.value.data;
        if (key === 'expenses' && item.expenses) {
          fullLog[key] = item.expenses;
        } else if (key === 'tasks' && item.tasks) {
          fullLog[key] = item.tasks;
        } else {
          fullLog[key] = item;
        }
      } else if (!fullLog[key]) {
        fullLog[key] = {}; 
      }
    });

    res.json(fullLog);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/daily/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    const authHeader = req.headers.authorization || `Bearer ${req.cookies.habitToken}`;

    // 1. Persist the FULL blob locally in this service
    let logDoc = await DailyLog.findOne({ userId: req.user._id, date });
    if (logDoc) {
      logDoc.data = data;
      await logDoc.save();
    } else {
      await DailyLog.create({ userId: req.user._id, date, data });
    }

    // 2. Split and save to each sub-service
    await Promise.allSettled(
      Object.entries(SERVICES).map(([key, url]) => {
        const endpoint = key === 'books' ? 'book-log' : key;
        let sectionData = data[key] || {};
        
        // Special case: Expenses service expects { expenses: [...] }
        if (key === 'expenses' && Array.isArray(sectionData)) {
          sectionData = { expenses: sectionData };
        }

        return axios.post(`${url}/api/${endpoint}/${date}`, sectionData, {
          headers: { Authorization: authHeader },
          withCredentials: true
        });
      })
    );

    // 3. Notify Analytics
    try {
      const analyticsUrl = process.env.ANALYTICS_SERVICE_URL || 'http://analytics:5113';
      await axios.post(`${analyticsUrl}/api/analytics/ingest`, {
        date,
        totalScore: data.totalScore || 0,
        rank: data.rank || 'N/A',
        totalExpenses: data.expenses?.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0) || 0,
        bookPages: data.books?.page || 0
      }, { 
        headers: { Authorization: authHeader },
        withCredentials: true
      });
    } catch (err) {
      console.error(`Aggregator -> Analytics Failure: ${err.message}`);
    }

    res.json(data);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5105;

connectDB('Daily Aggregator Service').then(() => {
  app.listen(PORT, () => console.log(`Daily Aggregator Service running on port ${PORT}`));
});