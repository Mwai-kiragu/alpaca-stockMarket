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
const { register: metricsRegister, requestDurationMiddleware } = require('./utils/metrics');
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
const fundingRoutes = require('./routes/funding');
const kcbRoutes = require('./routes/kcb');
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
const callbackRoutes = require('./routes/callback');
const productionCallbackRoutes = require('./routes/productionCallback');
const waitlistRoutes = require('./routes/waitlist');
const referralRoutes = require('./routes/referral');
const paperTradingRoutes = require('./routes/paperTrading');

// MyStocks Africa routes (wallet, bonds/funds, webhooks)
const msWalletRoutes = require('./routes/mystocks/msWallet');
const msBondsFundsRoutes = require('./routes/mystocks/msBondsFunds');
const msWebhooksRoutes = require('./routes/mystocks/msWebhooks');

// Payment WebSocket handler
const { handlePaymentWebSocket } = require('./routes/paymentWebSocket');
const postRoutes = require('./routes/posts');
const pageRoutes = require('./routes/pages');
const socialRoutes = require('./routes/social');

const app = express();
const server = createServer(app);

// Socket.IO must be initialized BEFORE express-ws.
// Both attach a listener to server's 'upgrade' event. Node.js fires them in registration order.
// express-ws destroys unmatched upgrade sockets — if it runs first, Socket.IO never gets them.
// By registering Socket.IO's upgrade handler first, /socket.io/ upgrades are handled correctly;
// express-ws then handles /ws/ paths for its registered app.ws() routes.
const io = websocketService.initialize(server);
app.set('io', io);

// Native WebSocket for payment notifications — registered after Socket.IO upgrade handler
const expressWs = require('express-ws')(app, server);

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests from this IP, please try again later.',
  validate: { xForwardedForHeader: false },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts, please try again later.',
  validate: { xForwardedForHeader: false },
});

// Block suspicious requests
app.use((req, res, next) => {
  const suspiciousPaths = [
    '/wp-config',
    '/appsettings',
    '/cgi-bin',
    '/.env',
    '/parameters.yml'
  ];

  if (suspiciousPaths.some(path => req.path.includes(path))) {
    logger.warn(`Blocked suspicious request: ${req.ip} ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
app.use(limiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestDurationMiddleware);

// Serve static files for uploads
app.use('/uploads', express.static('uploads'));

// Core authentication and onboarding endpoints
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/user', onboardingRoutes);
app.use('/api/v1/onboarding', onboardingRoutes);

// Payment callback endpoint (no auth required - called by external services)
app.use('/api/v1/callback', callbackRoutes);
app.use('/api/v1/production/callback', productionCallbackRoutes);

// Waitlist endpoint (public + admin endpoints)
app.use('/api/v1/waitlist', waitlistRoutes);

// Referral endpoint (for logged-in users)
app.use('/api/v1/referral', referralRoutes);

// Trading platform endpoints
app.use('/api/v1/biometric', biometricRoutes);
app.use('/api/v1/wallet', walletRoutes);
app.use('/api/v1/funding', fundingRoutes);
app.use('/api/v1/kcb', kcbRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/stocks', stockRoutes);
app.use('/api/v1/portfolio', portfolioRoutes);
app.use('/api/v1/paper-trading', paperTradingRoutes);
app.use('/api/v1/assets', assetRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/updates', updatesRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/admin', adminRoutes);

// MyStocks Africa
app.use('/api/v1/ms', msWalletRoutes);
app.use('/api/v1/ms', msBondsFundsRoutes);
app.use('/api/v1/ms', msWebhooksRoutes);

// Development/Testing routes
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/v1/sms', smsTestRoutes);
}
app.use('/api/v1/waitlist', waitlistRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/pages', pageRoutes);
app.use('/api/v1/social', socialRoutes);

app.get('/metrics', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    const ip = req.ip || req.connection.remoteAddress;
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      return res.status(403).end('Forbidden');
    }
  }
  try {
    res.set('Content-Type', metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

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

// Register native WebSocket endpoint for payment notifications (Redis-based)
app.ws('/ws/payment/:messageId', handlePaymentWebSocket);
logger.info('Native WebSocket endpoint registered: /ws/payment/:messageId');

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
  logger.info('- WebSocket (Socket.IO): Active');
  logger.info('- WebSocket (Native): Active at /ws/payment/:messageId');
  logger.info('- Notification System: Active');
  logger.info('- Batch Processor: Running');
});

module.exports = app;