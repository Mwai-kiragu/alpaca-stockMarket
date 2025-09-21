require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');

const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Core onboarding and authentication routes
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');

// Additional platform routes
const biometricRoutes = require('./routes/biometric');
const walletRoutes = require('./routes/wallet');
const orderRoutes = require('./routes/orders');
const stockRoutes = require('./routes/stocks');
const portfolioRoutes = require('./routes/portfolio');
const assetRoutes = require('./routes/assets');
const accountRoutes = require('./routes/account');
const updatesRoutes = require('./routes/updates');
const searchRoutes = require('./routes/search');
const notificationRoutes = require('./routes/notifications');
const supportRoutes = require('./routes/support');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

connectDB();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files for uploads
app.use('/uploads', express.static('uploads'));

// Core authentication and onboarding endpoints
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/user', onboardingRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);

// Trading platform endpoints
app.use('/api/v1/biometric', biometricRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/stocks', stockRoutes);
app.use('/api/v1/portfolio', portfolioRoutes);
app.use('/api/v1/assets', assetRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/updates', updatesRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/support', supportRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use(errorHandler);

io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.id}`);

  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

app.set('io', io);

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

module.exports = app;