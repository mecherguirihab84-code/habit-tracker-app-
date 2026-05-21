const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const webpush = require('web-push');
const Notification = require('./models/Notification');
const ProcessedEvent = require('./models/ProcessedEvent');
const PushSubscription = require('./models/PushSubscription');
const DeliveryRecord = require('./models/DeliveryRecord');
const { connectDB } = require('./db/mongoConnection');

// ── Web Push Setup ─────────────────────────────────────────────
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BCgZJNOei3SV_w0HlSfIU19B14iNQCN468a7deREHBZCNV7jbBwms6JJuIBF8SSTXZoh7hZFUBqDMfyZKdvWSgE';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'NFgyHMzWbXN2SAPCKzgqQTOMJ3LD6TReyUKLdYy59oM';

try {
  webpush.setVapidDetails('mailto:admin@evolvia.app', publicVapidKey, privateVapidKey);
} catch (err) {
  console.error('[Essentials Service] Web Push setup failed:', err.message);
}

// ── App Setup ──────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

// ── JWT Middleware ─────────────────────────────────────────────
const verifyToken = (req, res, next) => {
  let token;
  if (req.cookies.habitToken) token = req.cookies.habitToken;
  else if (req.headers.authorization?.startsWith('Bearer '))
    token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey_change_me_in_prod');
    req.user = { _id: decoded.id };
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// ── SSE Connection Registry ────────────────────────────────────
const sseClients = new Map();

function addSSEClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, []);
  sseClients.get(userId).push(res);
}

function removeSSEClient(userId, res) {
  const clients = sseClients.get(userId) || [];
  const filtered = clients.filter(c => c !== res);
  if (filtered.length === 0) sseClients.delete(userId);
  else sseClients.set(userId, filtered);
}

function sendSSEToUser(userId, eventData) {
  const clients = sseClients.get(userId);
  if (!clients || clients.length === 0) return;
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { /* ignore */ }
  }
}

// ── Notification Logic ──────────────────────────────────────────
function buildMessage(itemName, newStatus) {
  if (newStatus === 'BS') return `Running low on ${itemName}. Add it to your shopping list soon!`;
  if (newStatus === 'NA') return `You're out of ${itemName}! Purchase it immediately.`;
  return `${itemName} is now available.`;
}

async function deliverNotification(payload) {
  const { userId } = payload;
  
  // 1. Push SSE
  sendSSEToUser(userId, { ...payload, status: 'UNREAD' });

  // 2. Record delivery
  DeliveryRecord.create({
    userId,
    notificationId: payload.notificationId,
    channel: 'in-app',
    status: 'delivered',
    deliveredAt: new Date()
  }).catch(() => {});
}

async function processNotificationEvent(type, data) {
  const { userId, eventId } = data;

  // Idempotency check
  if (eventId) {
    try {
      await ProcessedEvent.create({ eventId });
    } catch (e) { return; } // Already processed
  }

  let message = data.message;
  if (!message && data.itemName && data.newStatus) {
    message = buildMessage(data.itemName, data.newStatus);
  }

  try {
    const notification = await Notification.create({
      userId,
      itemId: data.itemId || data.taskId,
      itemName: data.itemName || data.title,
      message,
      type: data.type || (data.taskId ? 'task-reminder' : 'reminder'),
      eventId: eventId || `gen_${Date.now()}_${Math.random()}`
    });

    const payload = {
      notificationId: notification._id.toString(),
      userId,
      itemId: notification.itemId,
      itemName: notification.itemName,
      message: notification.message,
      type: notification.type,
      timestamp: notification.timestamp
    };

    // Trigger Web Push
    try {
      const subscriptions = await PushSubscription.find({ userId });
      for (const sub of subscriptions) {
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({ title: 'Habit Tracker', body: message, url: payload.type === 'task-reminder' ? '/tasks' : '/essentials' })
        ).catch(async err => {
          if (err.statusCode === 410) await PushSubscription.deleteOne({ _id: sub._id });
        });
      }
    } catch (e) {}

    // Deliver via SSE
    deliverNotification(payload);

  } catch (err) {
    console.error('[Essentials Service] Error processing notification:', err.message);
  }
}

// ── Kafka Setup ────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'essentials-service',
  brokers: [(process.env.KAFKA_BROKER || 'kafka:9092')],
  retry: { retries: 2, initialRetryTime: 300 }
});

let consumer = null;
let producer = null;

async function startKafka() {
  try {
    producer = kafka.producer();
    await producer.connect();

    consumer = kafka.consumer({ groupId: 'essentials-service-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: 'item-status-changed', fromBeginning: false });
    await consumer.subscribe({ topic: 'task-notifications', fromBeginning: false });
    await consumer.subscribe({ topic: 'notifications-created', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          if (topic === 'notifications-created') {
            await deliverNotification(event);
          } else {
            await processNotificationEvent(topic, event);
          }
        } catch (e) {}
      }
    });
    console.log('[Essentials Service] Kafka connected');
  } catch (err) {
    console.warn('[Essentials Service] Kafka offline:', err.message);
  }
}

// ── REST API ───────────────────────────────────────────────────

app.get('/api/notifications/ping', (req, res) => res.json({ status: 'ok' }));

app.get('/api/notifications/vapidPublicKey', (req, res) => {
  res.json({ publicKey: publicVapidKey });
});

app.post('/api/notifications/subscribe', verifyToken, async (req, res) => {
  try {
    const subscription = req.body;
    await PushSubscription.findOneAndUpdate(
      { userId: req.user._id, endpoint: subscription.endpoint },
      { userId: req.user._id, ...subscription },
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Subscribed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/notifications', verifyToken, async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const filter = { userId: req.user._id };
    if (status && ['UNREAD', 'READ'].includes(status)) filter.status = status;

    const [notifs, total] = await Promise.all([
      Notification.find(filter).sort({ timestamp: -1 }).skip(Number(skip)).limit(Number(limit)),
      Notification.countDocuments(filter)
    ]);
    res.json({ notifications: notifs, total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/notifications/count', verifyToken, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({ userId: req.user._id, status: 'UNREAD' });
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/notifications/:id/read', verifyToken, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { status: 'READ' }, { new: true });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.put('/api/notifications/read-all', verifyToken, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, status: 'UNREAD' }, { status: 'READ' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// SSE Stream Endpoint
app.get('/api/delivery/stream', verifyToken, (req, res) => {
  const userId = req.user._id.toString();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);
  addSSEClient(userId, res);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(userId, res);
  });
});

// Internal Webhooks
app.post('/api/notifications/webhook', async (req, res) => {
  await processNotificationEvent('webhook', req.body);
  res.json({ ok: true });
});

app.post('/api/delivery/webhook', async (req, res) => {
  await deliverNotification(req.body);
  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', clients: sseClients.size }));

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5128;

connectDB('Notification Service').then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Essentials Service] Running on port ${PORT}`);
    startKafka();
  });
});

process.on('SIGTERM', async () => {
  if (consumer) await consumer.disconnect().catch(() => {});
  if (producer) await producer.disconnect().catch(() => {});
  process.exit(0);
});
