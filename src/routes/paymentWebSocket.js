const logger = require('../utils/logger');
const {
  subscribePaymentEvent,
  unsubscribePaymentEvent,
  getPendingPaymentMessage
} = require('../utils/redisPayment');

const paymentClients = {};

exports.handlePaymentWebSocket = (ws, req) => {
  const { messageId } = req.params;

  if (!messageId) {
    ws.send(JSON.stringify({
      status: 'ERROR',
      message: 'Invalid or missing messageId'
    }));
    ws.close();
    return;
  }

  logger.info(`Payment WebSocket connected for ${messageId}`);

  paymentClients[messageId] = ws;

  subscribePaymentEvent(messageId, (paymentData) => {
    sendPaymentNotification(messageId, paymentData);
  }).catch(error => {
    logger.error('Error subscribing to payment event:', error);
    ws.send(JSON.stringify({
      status: 'ERROR',
      message: 'Failed to subscribe to payment updates'
    }));
  });

  getPendingPaymentMessage(messageId)
    .then(pendingMessage => {
      if (pendingMessage) {
        // Payment already completed/failed before client connected
        logger.info(`Found pending payment message for ${messageId}`);
        ws.send(JSON.stringify(pendingMessage));

        // If payment is final (completed/failed), close connection after sending
        if (pendingMessage.status === 'completed' || pendingMessage.status === 'failed') {
          setTimeout(() => {
            ws.close();
          }, 1000); // Give time for message to be received
        }
      } else {
        // No pending message, send acknowledgement
        ws.send(JSON.stringify({
          status: 'CONNECTED',
          message: 'Waiting for payment status update...',
          messageId: messageId
        }));
      }
    })
    .catch(error => {
      logger.error('Error getting pending payment message:', error);
      ws.send(JSON.stringify({
        status: 'ERROR',
        message: 'Failed to check pending messages'
      }));
    });

  // Handle client disconnect
  ws.on('close', () => {
    logger.info(`Payment WebSocket disconnected for ${messageId}`);
    removePaymentClient(messageId);
  });

  // Handle client errors
  ws.on('error', (error) => {
    logger.error(`Payment WebSocket error for ${messageId}:`, error);
    removePaymentClient(messageId);
  });
};

function sendPaymentNotification(messageId, paymentData) {
  const ws = paymentClients[messageId];

  if (ws && ws.readyState === 1) { // 1 = OPEN
    ws.send(JSON.stringify(paymentData));

    logger.info(`Payment notification sent for ${messageId}:`, paymentData.status);

    // If payment is final (completed/failed), close connection
    if (paymentData.status === 'completed' || paymentData.status === 'failed') {
      setTimeout(() => {
        if (ws.readyState === 1) {
          ws.close();
        }
      }, 1000); // Give time for message to be received
    }
  } else {
    logger.warn(`No active WebSocket connection for ${messageId}`);
  }
}

function removePaymentClient(messageId) {
  // Unsubscribe from Redis pub/sub
  unsubscribePaymentEvent(messageId).catch(error => {
    logger.error('Error unsubscribing payment event:', error);
  });

  // Remove from tracking
  delete paymentClients[messageId];

  logger.info(`Removed payment client for ${messageId}`);
}

module.exports = exports;
