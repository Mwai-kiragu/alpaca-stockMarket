require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');

const { connectDB } = require('./config/database');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const websocketService = require('./services/websocketService');
const redisService = require('./config/redis');
const realtimeNotificationService = require('./services/realtimeNotificationService');
const batchNotificationProcessor = require('./services/batchNotificationProcessor');

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
const adminRoutes = require('./routes/admin');
const smsTestRoutes = require('./routes/smsTest');

const app = express();
const server = createServer(app);

// Trust proxy to properly handle X-Forwarded-* headers
// Trust only the first hop (immediate proxy) for better security
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Initialize database
connectDB();

// Initialize Redis
try {
  redisService.initialize();
  logger.info('Redis initialized successfully');
} catch (error) {
  logger.error('Failed to initialize Redis:', error);
  logger.warn('Continuing without Redis - some features may be limited');
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Block suspicious requests
app.use((req, res, next) => {
  const suspiciousPaths = [
    '/wp-config',
    '/appsettings',
    '/cgi-bin',
    '/.env',
    '/config',
    '/parameters.yml'
  ];

  if (suspiciousPaths.some(path => req.path.includes(path))) {
    logger.warn(`Blocked suspicious request: ${req.ip} ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
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
app.use('/api/v1/admin', adminRoutes);

// Development/Testing routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1/sms', smsTestRoutes);
}

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Trading Platform API',
    version: '1.0.0',
    status: 'Running',
    websocket: 'Available',
    endpoints: {
      health: '/health',
      assets: '/api/v1/assets',
      websocket: 'Connect to this same URL with Socket.IO client'
    }
  });
});

app.use(errorHandler);

// Initialize WebSocket service
const io = websocketService.initialize(server);
app.set('io', io);

// Initialize real-time notification services
try {
  realtimeNotificationService.initialize(websocketService);
  batchNotificationProcessor.start();
  logger.info('Real-time notification services initialized');
} catch (error) {
  logger.error('Failed to initialize notification services:', error);
}

server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  logger.info('Services status:');
  logger.info('- Database: Connected');
  logger.info(`- Redis: ${redisService.isConnected ? 'Connected' : 'Disconnected'}`);
  logger.info('- WebSocket: Active');
  logger.info('- Notification System: Active');
  logger.info('- Batch Processor: Running');
});

module.exports = app;