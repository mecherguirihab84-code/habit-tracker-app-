const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const auth = require('./middleware/auth');
const DailyNote = require('./models/DailyNote');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

// ── API Routes ───────────────────────────────────────────────

// Get notes for a specific date
app.get('/api/notes', auth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'Date parameter is required' });

    const notes = await DailyNote.find({ userId: req.user.id, date }).sort({ createdAt: 1 });
    res.json(notes);
  } catch (error) {
    console.error('[GET /api/notes] Error:', error.message);
    res.status(500).json({ message: 'Server error fetching notes' });
  }
});

// Add a new note
app.post('/api/notes', auth, async (req, res) => {
  try {
    const { date, content } = req.body;
    if (!date || !content) return res.status(400).json({ message: 'Date and content are required' });

    const note = new DailyNote({
      userId: req.user.id,
      date,
      content
    });

    await note.save();
    res.status(201).json(note);
  } catch (error) {
    console.error('[POST /api/notes] Error:', error.message);
    res.status(500).json({ message: 'Server error adding note' });
  }
});

// Update a note
app.put('/api/notes/:id', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'Content is required' });

    const note = await DailyNote.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { content },
      { new: true }
    );

    if (!note) return res.status(404).json({ message: 'Note not found' });
    res.json(note);
  } catch (error) {
    console.error('[PUT /api/notes] Error:', error.message);
    res.status(500).json({ message: 'Server error updating note' });
  }
});

// Delete a note
app.delete('/api/notes/:id', auth, async (req, res) => {
  try {
    const note = await DailyNote.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!note) return res.status(404).json({ message: 'Note not found' });
    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/notes] Error:', error.message);
    res.status(500).json({ message: 'Server error deleting note' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'notes-service' });
});

const PORT = process.env.PORT || 5132;

connectDB('Notes Service').then(() => {
  app.listen(PORT, () => {
    console.log(`Notes Service running on port ${PORT}`);
  });
});
