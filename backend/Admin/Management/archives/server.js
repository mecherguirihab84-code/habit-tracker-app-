const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const Archive = require('./models/Archive');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Archives Service API', version: '1.0.0', description: 'Book archives service', contact: { name: 'API Support', email: 'support@evolvia.com' } },
    servers: [{ url: 'http://localhost:5108' }],
    components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'habitToken' }, bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
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
 * /api/archives:
 *   get:
 *     summary: Get archived books
 *     tags: [Books]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Archives list
 */
app.get('/api/archives', verifyToken, async (req, res) => {
  try {
    let archive = await Archive.findOne({ userId: req.user._id });
    res.json({ archivedBooks: archive?.archivedBooks || [] });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/archives:
 *   post:
 *     summary: Archive a book
 *     tags: [Books]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bookName: { type: string }
 *               targetPages: { type: number }
 *               startDate: { type: string }
 *               finalPage: { type: number }
 *     responses:
 *       200:
 *         description: Book archived
 */
app.post('/api/archives', verifyToken, async (req, res) => {
  try {
    const { bookName, targetPages, startDate, finalPage } = req.body;
    let archive = await Archive.findOne({ userId: req.user._id });
    if (!archive) archive = new Archive({ userId: req.user._id, archivedBooks: [] });

    archive.archivedBooks.push({
      bookName, targetPages, startDate,
      completionDate: new Date().toISOString().split('T')[0],
      finalPage: finalPage || targetPages
    });
    await archive.save();

    res.json({ archivedBooks: archive.archivedBooks });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 5108;

connectDB('Archives Service').then(() => {
  app.listen(PORT, () => console.log(`Archives Service running on port ${PORT}`));
});