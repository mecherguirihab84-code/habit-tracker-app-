const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');
const Essential = require('./models/Essential');
const { connectDB } = require('./db/mongoConnection');

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

// ── Kafka Producer ─────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'item-service',
  brokers: [(process.env.KAFKA_BROKER || 'kafka:9092')],
  retry: { retries: 5, initialRetryTime: 300 }
});
const producer = kafka.producer();

let producerReady = false;
(async () => {
  try {
    await producer.connect();
    producerReady = true;
    console.log('[Item Service] Kafka producer connected');
  } catch (err) {
    console.warn('[Item Service] Kafka producer connection failed — events will not be published:', err.message);
  }
})();

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:5128';

async function publishStatusChange(payload) {
  if (producerReady) {
    try {
      await producer.send({
        topic: 'item-status-changed',
        messages: [{
          key: payload.userId,
          value: JSON.stringify(payload)
        }]
      });
      console.log('[Item Service] Event published to Kafka');
      return;
    } catch (err) {
      console.error('[Item Service] Kafka publish failed, trying HTTP fallback:', err.message);
    }
  }

  // Fallback to HTTP
  try {
    const url = new URL(`${NOTIFICATION_SERVICE_URL}/api/notifications/webhook`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options);
    req.on('error', (e) => console.error('[Item Service] HTTP fallback request error:', e.message));
    req.write(JSON.stringify(payload));
    req.end();
    console.log('[Item Service] Event sent via HTTP fallback');
  } catch (err) {
    console.error('[Item Service] HTTP fallback failed:', err.message);
  }
}

// ── Status Progression Guard ───────────────────────────────────
const STATUS_ORDER = ['A', 'BS', 'NA'];
function isForwardProgression(oldStatus, newStatus) {
  return STATUS_ORDER.indexOf(newStatus) > STATUS_ORDER.indexOf(oldStatus);
}

// ── Routes ─────────────────────────────────────────────────────

// GET /api/essentials — list all items for authenticated user
app.get('/api/essentials', verifyToken, async (req, res) => {
  try {
    const items = await Essential.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/essentials — create a new hygiene item
app.post('/api/essentials', verifyToken, async (req, res) => {
  try {
    const { name, icon } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Item name is required' });

    const item = await Essential.create({
      userId: req.user._id,
      name:   name.trim(),
      icon:   icon || '🧴',
      status: 'A'
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/essentials/:id — update name, icon, or status
app.put('/api/essentials/:id', verifyToken, async (req, res) => {
  try {
    const { name, icon, status } = req.body;
    const item = await Essential.findOne({ _id: req.params.id, userId: req.user._id });
    if (!item) return res.status(404).json({ message: 'Item not found' });

    const oldStatus = item.status;

    if (name !== undefined) item.name = name.trim();
    if (icon !== undefined) item.icon = icon;
    if (status !== undefined) {
      if (!['A', 'BS', 'NA'].includes(status))
        return res.status(400).json({ message: 'Invalid status. Must be A, BS, or NA' });
      item.status = status;
    }
    item.lastUpdated = new Date();
    await item.save();

    // Publish Kafka event only when status actually changed
    if (status !== undefined && status !== oldStatus) {
      await publishStatusChange({
        eventId:    uuidv4(),
        userId:     req.user._id,
        itemId:     item._id.toString(),
        itemName:   item.name,
        oldStatus,
        newStatus:  status,
        isUrgent:   status === 'NA',
        isForward:  isForwardProgression(oldStatus, status),
        timestamp:  new Date().toISOString()
      });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/essentials/:id — remove an item
app.delete('/api/essentials/:id', verifyToken, async (req, res) => {
  try {
    const item = await Essential.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item deleted', id: req.params.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'item-service' }));

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5127;

connectDB('Item Service').then(() => {
  app.listen(PORT, () => console.log(`[Item Service] Running on port ${PORT}`));
});

process.on('SIGTERM', async () => {
  if (producerReady) await producer.disconnect();
  process.exit(0);
});
