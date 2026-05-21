const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const WeekendDuty = require('./models/WeekendDuty');
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

app.get('/api/weekend', verifyToken, async (req, res) => {
  try {
    const duties = await WeekendDuty.find({ userId: req.user._id });
    res.json(duties);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/weekend/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let duty = await WeekendDuty.findOne({ userId: req.user._id, date });
    if (!duty) {
      duty = {
        saturday: { preLaundry: false },
        sunday: { cleanRoom: false, regularLaundry: false, shareBought: false }
      };
    }
    res.json(duty);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/weekend/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let duty = await WeekendDuty.findOne({ userId: req.user._id, date });
    if (duty) {
      Object.assign(duty, data);
      await duty.save();
    } else {
      duty = await WeekendDuty.create({ userId: req.user._id, date, ...data });
    }
    res.json(duty);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5121;

connectDB('Weekend Duties Service').then(() => {
  app.listen(PORT, () => console.log(`Weekend Duties Service running on port ${PORT}`));
});
