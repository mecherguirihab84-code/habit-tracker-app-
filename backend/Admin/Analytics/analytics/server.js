const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const Analytics = require('./models/Analytics');
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
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://verify:5104';
    const response = await axios.get(`${authServiceUrl}/api/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      withCredentials: true
    });
    req.user = { _id: response.data.userId };
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

app.post('/api/analytics/ingest', verifyToken, async (req, res) => {
  try {
    const { date, totalScore, rank, totalExpenses, bookPages } = req.body;
    
    let analytics = await Analytics.findOne({ userId: req.user._id, date });
    
    if (analytics) {
      analytics.totalScore = totalScore;
      analytics.rank = rank;
      analytics.totalExpenses = totalExpenses;
      analytics.bookPages = bookPages;
      await analytics.save();
    } else {
      analytics = await Analytics.create({
        userId: req.user._id,
        date,
        totalScore,
        rank,
        totalExpenses,
        bookPages
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/analytics/weekly/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 6);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = date;
    
    const data = await Analytics.find({
      userId: req.user._id,
      date: { $gte: startStr, $lte: endStr }
    }).sort({ date: 1 });
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/analytics/monthly/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const startDate = new Date(date);
    startDate.setDate(1);
    
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = date;
    
    const data = await Analytics.find({
      userId: req.user._id,
      date: { $gte: startStr, $lte: endStr }
    }).sort({ date: 1 });
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/analytics/summary', verifyToken, async (req, res) => {
  try {
    const allData = await Analytics.find({ userId: req.user._id });
    
    const totalDays = allData.length;
    const avgScore = totalDays > 0 
      ? allData.reduce((sum, d) => sum + d.totalScore, 0) / totalDays 
      : 0;
    const totalExpenses = allData.reduce((sum, d) => sum + d.totalExpenses, 0);
    const totalPages = allData.reduce((sum, d) => sum + d.bookPages, 0);
    
    const rankCounts = allData.reduce((acc, d) => {
      acc[d.rank] = (acc[d.rank] || 0) + 1;
      return acc;
    }, {});
    
    res.json({
      totalDays,
      avgScore: Math.round(avgScore * 10) / 10,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalPages,
      rankCounts
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5113;

connectDB('Analytics Service').then(() => {
  app.listen(PORT, () => console.log(`Analytics Service running on port ${PORT}`));
});