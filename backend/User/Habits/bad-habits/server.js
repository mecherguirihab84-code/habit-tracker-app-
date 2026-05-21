const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const BadHabit = require('./models/BadHabit');
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

app.get('/api/bad', verifyToken, async (req, res) => {
  try {
    const habits = await BadHabit.find({ userId: req.user._id });
    res.json(habits);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/bad/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let habit = await BadHabit.findOne({ userId: req.user._id, date });
    if (!habit) {
      habit = {
        smoking: { checked: false, count: 0 },
        sexual: { checked: false },
        social: { checked: false, min: 0 },
        phone: { checked: false, min: 0 },
        coffee: { checked: false },
        eating: { checked: false },
        noSugar: { checked: false }
      };
    }
    res.json(habit);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/bad/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let habit = await BadHabit.findOne({ userId: req.user._id, date });
    if (habit) {
      Object.assign(habit, data);
      await habit.save();
    } else {
      habit = await BadHabit.create({ userId: req.user._id, date, ...data });
    }
    res.json(habit);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5119;

connectDB('Bad Habits Service').then(() => {
  app.listen(PORT, () => console.log(`Bad Habits Service running on port ${PORT}`));
});
