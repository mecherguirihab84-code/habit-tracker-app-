const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const SystemCheck = require('./models/SystemCheck');
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

app.get('/api/system', verifyToken, async (req, res) => {
  try {
    const checks = await SystemCheck.find({ userId: req.user._id });
    res.json(checks);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/system/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let check = await SystemCheck.findOne({ userId: req.user._id, date });
    if (!check) {
      check = { todo: false, money: false };
    }
    res.json(check);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/system/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let check = await SystemCheck.findOne({ userId: req.user._id, date });
    if (check) {
      Object.assign(check, data);
      await check.save();
    } else {
      check = await SystemCheck.create({ userId: req.user._id, date, ...data });
    }
    res.json(check);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5125;

connectDB('System Check Service').then(() => {
  app.listen(PORT, () => console.log(`System Check Service running on port ${PORT}`));
});
