const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const UserPrefs = require('./models/UserPrefs');
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

// ── Routes ─────────────────────────────────────────────────────

// GET /api/user-prefs — get or create preferences for the current user
app.get('/api/user-prefs', verifyToken, async (req, res) => {
  try {
    // findOrCreate pattern — return defaults if not yet configured
    let prefs = await UserPrefs.findOne({ userId: req.user._id });
    if (!prefs) {
      prefs = await UserPrefs.create({ userId: req.user._id });
    }
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/user-prefs — update preferences
app.put('/api/user-prefs', verifyToken, async (req, res) => {
  try {
    const { notificationsEnabled, channels, frequency } = req.body;
    const update = {};
    if (notificationsEnabled !== undefined) update.notificationsEnabled = notificationsEnabled;
    if (channels !== undefined) update.channels = channels;
    if (frequency !== undefined && ['instant', 'daily'].includes(frequency))
      update.frequency = frequency;

    const prefs = await UserPrefs.findOneAndUpdate(
      { userId: req.user._id },
      { $set: update },
      { new: true, upsert: true }
    );
    res.json(prefs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'user-prefs-service' }));

// ── Start ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5130;

connectDB('User Prefs Service').then(() => {
  app.listen(PORT, () => console.log(`[User Prefs Service] Running on port ${PORT}`));
});
