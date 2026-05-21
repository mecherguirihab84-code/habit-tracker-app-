const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const Log = require('./models/Log');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

const verifyToken = async (req, res, next) => {
  let token;
  if (req.cookies.habitToken) {
    token = req.cookies.habitToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  try {
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth:5001';
    const response = await axios.get(`${authServiceUrl}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true
    });
    req.user = response.data;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

app.get('/api/habits', verifyToken, async (req, res) => {
  try {
    const logs = await Log.find({ userId: req.user._id });
    const logsObj = {};
    logs.forEach(l => {
      logsObj[l.date] = l.data;
    });
    res.json(logsObj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/habits/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;

    let log = await Log.findOne({ userId: req.user._id, date });

    if (log) {
      log.data = data;
      await log.save();
    } else {
      log = await Log.create({ userId: req.user._id, date, data });
    }

    res.json(log.data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5002;

connectDB('Habit Service').then(() => {
  app.listen(PORT, () => console.log(`Habit Service running on port ${PORT}`));
});