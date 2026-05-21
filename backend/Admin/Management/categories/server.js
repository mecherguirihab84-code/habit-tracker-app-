const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const Category = require('./models/Category');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Categories Service API', version: '1.0.0', description: 'Expense categories service', contact: { name: 'API Support', email: 'support@evolvia.com' } },
    servers: [{ url: 'http://localhost:5110' }],
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
 * /api/categories:
 *   get:
 *     summary: Get categories
 *     tags: [Profile]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       200:
 *         description: Categories list
 */
app.get('/api/categories', verifyToken, async (req, res) => {
  try {
    let category = await Category.findOne({ userId: req.user._id });
    if (!category) { category = await Category.create({ userId: req.user._id }); }
    res.json({ expenseCategories: category.expenseCategories });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/categories:
 *   post:
 *     summary: Add category
 *     tags: [Profile]
 *     security: [{ cookieAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category: { type: string }
 *     responses:
 *       200:
 *         description: Category added
 */
app.post('/api/categories', verifyToken, async (req, res) => {
  try {
    const { category } = req.body;
    if (!category?.trim()) return res.status(400).json({ message: 'Category name is required' });

    let categoryDoc = await Category.findOne({ userId: req.user._id });
    if (!categoryDoc) categoryDoc = await Category.create({ userId: req.user._id });
    
    if (categoryDoc.expenseCategories.includes(category.trim())) {
      return res.status(400).json({ message: 'Category already exists' });
    }

    categoryDoc.expenseCategories.push(category.trim());
    await categoryDoc.save();

    res.json({ expenseCategories: categoryDoc.expenseCategories });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/categories/{category}:
 *   delete:
 *     summary: Delete category
 *     tags: [Profile]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Category deleted
 */
app.delete('/api/categories/:category', verifyToken, async (req, res) => {
  try {
    const { category } = req.params;
    let categoryDoc = await Category.findOne({ userId: req.user._id });
    
    if (categoryDoc) {
      categoryDoc.expenseCategories = categoryDoc.expenseCategories.filter(c => c !== decodeURIComponent(category));
      await categoryDoc.save();
    }

    res.json({ expenseCategories: categoryDoc?.expenseCategories || [] });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

/**
 * @swagger
 * /api/categories/{category}:
 *   put:
 *     summary: Update category
 *     tags: [Profile]
 *     security: [{ cookieAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               newCategory: { type: string }
 *     responses:
 *       200:
 *         description: Category updated
 */
app.put('/api/categories/:category', verifyToken, async (req, res) => {
  try {
    const oldCategory = decodeURIComponent(req.params.category);
    const { newCategory } = req.body;
    
    if (!newCategory?.trim()) return res.status(400).json({ message: 'New category name is required' });

    let categoryDoc = await Category.findOne({ userId: req.user._id });
    if (!categoryDoc) return res.status(404).json({ message: 'Category not found' });
    
    if (categoryDoc.expenseCategories.includes(newCategory.trim())) {
      return res.status(400).json({ message: 'Category already exists' });
    }

    const idx = categoryDoc.expenseCategories.indexOf(oldCategory);
    if (idx !== -1) {
      categoryDoc.expenseCategories[idx] = newCategory.trim();
      await categoryDoc.save();
    }

    res.json({ expenseCategories: categoryDoc.expenseCategories });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

const PORT = process.env.PORT || 5110;

connectDB('Categories Service').then(() => {
  app.listen(PORT, () => console.log(`Categories Service running on port ${PORT}`));
});