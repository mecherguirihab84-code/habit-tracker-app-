const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const Book = require('./models/Book');
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

app.get('/api/books/current', verifyToken, async (req, res) => {
  try {
    let book = await Book.findOne({ userId: req.user._id });
    if (!book) {
      book = await Book.create({ userId: req.user._id });
    }
    res.json(book.currentBook);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/books/current', verifyToken, async (req, res) => {
  try {
    const { bookName, targetPages } = req.body;
    
    if (!bookName || !bookName.trim()) {
      return res.status(400).json({ message: 'Book name is required' });
    }
    if (!targetPages || targetPages <= 0) {
      return res.status(400).json({ message: 'Target pages must be greater than 0' });
    }

    let book = await Book.findOne({ userId: req.user._id });
    if (!book) {
      book = await Book.create({ userId: req.user._id });
    }

    book.currentBook = {
      bookName: bookName.trim(),
      targetPages: parseInt(targetPages),
      startDate: new Date().toISOString().split('T')[0],
      isActive: true
    };
    await book.save();

    res.json(book.currentBook);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/books/current', verifyToken, async (req, res) => {
  try {
    const { isActive, finalPage } = req.body;
    
    let book = await Book.findOne({ userId: req.user._id });
    if (!book) {
      return res.status(400).json({ message: 'No book found' });
    }
    if (!book.currentBook.bookName) {
      return res.status(400).json({ message: 'No active book' });
    }

    if (isActive === false && book.currentBook.isActive === true) {
      const archivedBook = {
        bookName: book.currentBook.bookName,
        targetPages: book.currentBook.targetPages,
        startDate: book.currentBook.startDate,
        completionDate: new Date().toISOString().split('T')[0],
        finalPage: finalPage || book.currentBook.targetPages
      };
      
      if (!book.archivedBooks) {
        book.archivedBooks = [];
      }
      book.archivedBooks.push(archivedBook);
      book.currentBook = {
        bookName: '',
        targetPages: 0,
        startDate: '',
        isActive: false
      };
    } else {
      book.currentBook.isActive = isActive !== undefined ? isActive : false;
    }
    
    await book.save();

    res.json({
      currentBook: book.currentBook,
      archivedBooks: book.archivedBooks || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/books/archived', verifyToken, async (req, res) => {
  try {
    let book = await Book.findOne({ userId: req.user._id });
    res.json({ archivedBooks: book?.archivedBooks || [] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5003;

connectDB('Book Service').then(() => {
  app.listen(PORT, () => console.log(`Book Service running on port ${PORT}`));
});