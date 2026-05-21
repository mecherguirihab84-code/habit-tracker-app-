const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const VideoEditing = require('./models/VideoEditing');
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

app.get('/api/video', verifyToken, async (req, res) => {
  try {
    const videos = await VideoEditing.find({ userId: req.user._id });
    res.json(videos);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/video/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    let video = await VideoEditing.findOne({ userId: req.user._id, date });
    if (!video) {
      video = { task: '', time: '', achieved: false, progress: 'Same', lessons: [] };
    }
    res.json(video);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/video/:date', verifyToken, async (req, res) => {
  try {
    const { date } = req.params;
    const data = req.body;
    let video = await VideoEditing.findOne({ userId: req.user._id, date });
    if (video) {
      Object.assign(video, data);
      await video.save();
    } else {
      video = await VideoEditing.create({ userId: req.user._id, date, ...data });
    }
    res.json(video);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5123;

connectDB('Video Editing Service').then(() => {
  app.listen(PORT, () => console.log(`Video Editing Service running on port ${PORT}`));
});
