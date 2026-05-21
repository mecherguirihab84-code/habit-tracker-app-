const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { Kafka } = require('kafkajs');
const DeliveryRecord = require('./models/DeliveryRecord');
const { connectDB } = require('./db/mongoConnection');

// ── Kafka Setup ────────────────────────────────────────────────
const kafka = new Kafka({
  clientId: 'delivery-service',
  brokers: [(process.env.KAFKA_BROKER || 'kafka:9092')],
  retry: { retries: 5, initialRetryTime: 300 }
});

const consumer = kafka.consumer({ groupId: 'delivery-service-group' });

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
// Maps userId → array of SSE response objects (supports multiple tabs/devices)
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
    try {
      client.write(payload);
    } catch {
      // Client disconnected — will be cleaned up on 'close' event
    }
  }
}

function deliverNotification(event) {
  const { notificationId, userId, itemName, message: msg, type, timestamp } = event;

  // ── Push SSE to any connected frontend clients ──────────
  sendSSEToUser(userId, {
    notificationId,
    userId,
    itemName,
    message: msg,
    type,
    timestamp,
    status: 'UNREAD'
  });

  // ── Record delivery in DB ──────────────────────────────
  DeliveryRecord.create({
    userId,
    notificationId,
    channel:     'in-app',
    status:      'delivered',
    deliveredAt: new Date()
  }).catch(err => console.error('[Delivery Service] Failed to record delivery:', err.message));
}

async function startKafkaConsumer() {
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: 'notifications-created', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const event = JSON.parse(message.value.toString());
          deliverNotification(event);
        } catch (err) {
          console.warn('[Delivery Service] Kafka message error:', err.message);
        }
      }
    });

    console.log('[Delivery Service] Kafka consumer running on topic: notifications-created');
  } catch (err) {
    console.warn('[Delivery Service] Kafka not available:', err.message);
  }
}

// ── SSE Stream Endpoint ────────────────────────────────────────
// GET /api/delivery/stream  — clients open this long-lived connection
app.get('/api/delivery/stream', verifyToken, (req, res) => {
  const userId = req.user._id.toString();

  // Required SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Send an initial heartbeat so the browser confirms the connection
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

  addSSEClient(userId, res);
  console.log(`[Delivery Service] SSE client connected: ${userId} (${sseClients.get(userId).length} total)`);

  // Heartbeat every 25s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeSSEClient(userId, res);
    console.log(`[Delivery Service] SSE client disconnected: ${userId}`);
  });
});

// GET /api/delivery/health
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'delivery-service', sseClients: sseClients.size }));

// Internal Webhook for HTTP Fallback
app.post('/api/delivery/webhook', async (req, res) => {
  try {
    deliverNotification(req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5129;

connectDB('Delivery Service').then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Delivery Service] Running on port ${PORT}`);
    startKafkaConsumer();
  });
});

process.on('SIGTERM', async () => {
  try {
    await consumer.disconnect();
  } catch (e) {}
  process.exit(0);
});

