const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const CurrentBook = require('./models/CurrentBook');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Current Book Service API',
      version: '1.0.0',
      description: 'Current reading book service',
      contact: { name: 'API Support', email: 'support@evolvia.com' }
    },
    servers: [{ url: 'http://localhost:5107' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'habitToken' },
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    },
    security: [{ cookieAuth: [] }, { bearerAuth: [] }]
  },
  apis: ['./server.js']
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

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

/**
 * @swagger
 * /api/currentbook:
 *   get:
 *     summary: Get current book
 *     tags: [Books]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current book data
 */
app.get('/api/currentbook', verifyToken, async (req, res) => {
  try {
    let book = await CurrentBook.findOne({ userId: req.user._id });
    if (!book) { book = await CurrentBook.create({ userId: req.user._id }); }
    res.json({ bookName: book.bookName, targetPages: book.targetPages, startDate: book.startDate, isActive: book.isActive });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/currentbook:
 *   post:
 *     summary: Set current book
 *     tags: [Books]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bookName
 *               - targetPages
 *             properties:
 *               bookName:
 *                 type: string
 *               targetPages:
 *                 type: number
 *     responses:
 *       200:
 *         description: Book set
 */
app.post('/api/currentbook', verifyToken, async (req, res) => {
  try {
    const { bookName, targetPages } = req.body;
    if (!bookName?.trim()) return res.status(400).json({ message: 'Book name is required' });
    if (!targetPages || targetPages <= 0) return res.status(400).json({ message: 'Target pages must be greater than 0' });

    let book = await CurrentBook.findOne({ userId: req.user._id });
    if (!book) book = new CurrentBook({ userId: req.user._id });

    book.bookName = bookName.trim();
    book.targetPages = parseInt(targetPages);
    book.startDate = new Date().toISOString().split('T')[0];
    book.isActive = true;
    await book.save();

    res.json({ bookName: book.bookName, targetPages: book.targetPages, startDate: book.startDate, isActive: book.isActive });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/currentbook:
 *   put:
 *     summary: Update current book
 *     tags: [Books]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Book updated
 */
app.put('/api/currentbook', verifyToken, async (req, res) => {
  try {
    const { isActive } = req.body;
    let book = await CurrentBook.findOne({ userId: req.user._id });
    if (!book || !book.bookName) return res.status(400).json({ message: 'No active book' });

    book.isActive = isActive !== undefined ? isActive : false;
    await book.save();

    res.json({ bookName: book.bookName, targetPages: book.targetPages, startDate: book.startDate, isActive: book.isActive });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const PORT = process.env.PORT || 5107;

connectDB('CurrentBook Service').then(() => {
  app.listen(PORT, () => console.log(`CurrentBook Service running on port ${PORT}`));
});