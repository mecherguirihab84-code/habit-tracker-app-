const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Expense = require('./models/Expense');
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

app.get('/api/expenses', verifyToken, async (req, res) => {
  try {
    const expenses = await Expense.find({ userId: req.user._id });
    res.json(expenses);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/expenses/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let data = await Expense.findOne({ userId: req.user._id, date });
    if (!data) {
      data = { expenses: [] };
    }
    res.json(data);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/expenses/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const { expenses } = req.body;
    let data = await Expense.findOne({ userId: req.user._id, date });
    if (data) {
      data.expenses = expenses;
      await data.save();
    } else {
      data = await Expense.create({ userId: req.user._id, date, expenses });
    }
    res.json(data);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5126;

connectDB('Expenses Service').then(() => {
  app.listen(PORT, () => console.log(`Expenses Service running on port ${PORT}`));
});
