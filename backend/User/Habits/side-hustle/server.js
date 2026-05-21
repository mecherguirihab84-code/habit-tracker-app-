const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const SideHustle = require('./models/SideHustle');
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

app.get('/api/hustle', verifyToken, async (req, res) => {
  try {
    const hustles = await SideHustle.find({ userId: req.user._id });
    res.json(hustles);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/hustle/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let hustle = await SideHustle.findOne({ userId: req.user._id, date });
    if (!hustle) {
      hustle = { task: '', time: '', achieved: false, lessons: [] };
    }
    res.json(hustle);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/hustle/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let hustle = await SideHustle.findOne({ userId: req.user._id, date });
    if (hustle) {
      Object.assign(hustle, data);
      await hustle.save();
    } else {
      hustle = await SideHustle.create({ userId: req.user._id, date, ...data });
    }
    res.json(hustle);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5122;

connectDB('Side Hustle Service').then(() => {
  app.listen(PORT, () => console.log(`Side Hustle Service running on port ${PORT}`));
});
