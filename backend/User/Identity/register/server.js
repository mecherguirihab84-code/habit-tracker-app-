const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const User = require('./models/User');
const { connectDB } = require('./db/mongoConnection');

const app = express();
app.use(express.json());
app.use(cookieParser());

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Register Service API',
      version: '1.0.0',
      description: 'User registration service',
      contact: { name: 'API Support', email: 'support@evolvia.com' }
    },
    servers: [{ url: 'http://localhost:5102' }],
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'habitToken' }
      }
    },
    security: [{ cookieAuth: [] }]
  },
  apis: ['./server.js']
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /api/register:
 *   post:
 *     summary: Register new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - confirmPassword
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created
 *       400:
 *         description: Validation error
 */
app.post('/api/register', async (req, res) => {
  const { email, password, confirmPassword } = req.body;
  if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match' });
  
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });

    const userId = 'user_' + Date.now();
    const user = await User.create({ userId, email, password });
    
    const token = jwt.sign({ id: user.userId, email: user.email }, process.env.JWT_SECRET || 'supersecretjwtkey_change_me_in_prod', { expiresIn: '30d' });
    res.cookie('habitToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    
    res.status(201).json({ 
      userId: user.userId, 
      email: user.email, 
      firstName: '', 
      lastName: '',
      token
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5102;

connectDB('Register Service').then(() => {
  app.listen(PORT, () => console.log(`Register Service running on port ${PORT}`));
});
