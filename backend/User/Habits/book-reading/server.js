const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const BookReading = require('./models/BookReading');
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

app.get('/api/book-log', verifyToken, async (req, res) => {
  try {
    const logs = await BookReading.find({ userId: req.user._id });
    res.json(logs);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/book-log/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let log = await BookReading.findOne({ userId: req.user._id, date });
    if (!log) {
      log = { name: '', page: '', read: false };
    }
    res.json(log);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/book-log/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let log = await BookReading.findOne({ userId: req.user._id, date });
    if (log) {
      Object.assign(log, data);
      await log.save();
    } else {
      log = await BookReading.create({ userId: req.user._id, date, ...data });
    }
    res.json(log);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5124;

connectDB('Book Reading Service').then(() => {
  app.listen(PORT, () => console.log(`Book Reading Log Service running on port ${PORT}`));
});
