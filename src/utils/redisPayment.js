const logger = require('./logger');

// Use existing Redis client from environment
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = require('redis');

// Create two separate clients - one for pub, one for sub
const redisClient = redis.createClient({ url: redisUrl });
const redisPub = redis.createClient({ url: redisUrl });

// Connection handlers
redisClient.on('connect', () => {
  logger.info('Redis Client (Sub) Connected for Payment Notifications');
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error:', err);
});

redisPub.on('connect', () => {
  logger.info('Redis Pub Connected for Payment Notifications');
});

redisPub.on('error', (err) => {
  logger.error('Redis Pub Error:', err);
});

// Connect both clients
redisClient.connect().catch(err => logger.error('Redis Client connect error:', err));
redisPub.connect().catch(err => logger.error('Redis Pub connect error:', err));

exports.subscribePaymentEvent = async function (messageId, callback) {
  const eventKey = `mpesa:payment:${messageId}`;

  await redisClient.subscribe(eventKey, (jsonMessage) => {
    try {
      logger.info(`Received payment event for ${messageId}`);
      const message = JSON.parse(jsonMessage);
      callback(message);
    } catch (error) {
      logger.error('Error parsing payment event:', error);
    }
  });

  logger.info(`Subscribed to payment events for ${messageId}`);
};

exports.unsubscribePaymentEvent = async function (messageId) {
  const eventKey = `mpesa:payment:${messageId}`;
  await redisClient.unsubscribe(eventKey);
  logger.info(`Unsubscribed from payment events for ${messageId}`);
};

exports.getPendingPaymentMessage = async function (messageId) {
  const eventKey = `mpesa:payment:${messageId}`;

  try {
    const value = await redisPub.get(eventKey);

    if (value) {
      logger.info(`Found pending payment message for ${messageId}`);
      return JSON.parse(value);
    }

    return null;
  } catch (error) {
    logger.error('Error getting pending payment message:', error);
    return null;
  }
};

exports.publishPaymentEvent = async function (messageId, paymentData) {
  const eventKey = `mpesa:payment:${messageId}`;
  const KEY_TTL = 120; // 2 minutes - enough time for late arrivals

  const payload = {
    messageId,
    status: paymentData.status, // 'completed', 'failed', 'pending'
    amount: paymentData.amount,
    currency: paymentData.currency || 'KES',
    reference: paymentData.reference, // M-Pesa receipt number
    timestamp: paymentData.timestamp || new Date().toISOString(),
    message: paymentData.message,
    wallet: paymentData.wallet, // Updated wallet balance
    metadata: paymentData.metadata,
    userId: paymentData.userId
  };

  try {
    // Store for late arrivals (clients that connect after callback)
    await redisPub.setEx(eventKey, KEY_TTL, JSON.stringify(payload));

    // Publish to all currently connected subscribers
    await redisPub.publish(eventKey, JSON.stringify(payload));

    logger.info(`Published payment event for ${messageId}:`, payload.status);
  } catch (error) {
    logger.error('Error publishing payment event:', error);
    throw error;
  }
};

exports.deletePaymentEvent = async function (messageId) {
  const eventKey = `mpesa:payment:${messageId}`;

  try {
    await redisPub.del(eventKey);
    logger.info(`Deleted payment event data for ${messageId}`);
  } catch (error) {
    logger.error('Error deleting payment event:', error);
  }
};

exports.storePaymentMetadata = async function (messageId, metadata) {
  const metaKey = `mpesa:meta:${messageId}`;
  const KEY_TTL = 600; // 10 minutes

  try {
    await redisPub.setEx(metaKey, KEY_TTL, JSON.stringify(metadata));
    logger.info(`Stored payment metadata for ${messageId}`);
  } catch (error) {
    logger.error('Error storing payment metadata:', error);
  }
};

exports.getPaymentMetadata = async function (messageId) {
  const metaKey = `mpesa:meta:${messageId}`;

  try {
    const value = await redisPub.get(metaKey);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error('Error getting payment metadata:', error);
    return null;
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Closing Redis connections...');
  await redisClient.quit();
  await redisPub.quit();
  process.exit(0);
});

module.exports = exports;
