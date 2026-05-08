const notificationService = require('../services/notificationService');
const realtimeNotificationService = require('../services/realtimeNotificationService');
const batchNotificationProcessor = require('../services/batchNotificationProcessor');
const pushNotificationService = require('../services/pushNotificationService');
const notificationDeduplicationService = require('../services/notificationDeduplicationService');
const { User, NotificationPreferences, Notification } = require('../models');
const logger = require('../utils/logger');

// Add/Update device token for push notifications
const addDeviceToken = async (req, res) => {
  try {
    const { deviceToken, platform, deviceInfo } = req.body;
    const userId = req.user.id;

    if (!deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    const result = await notificationService.addDeviceToken(userId, deviceToken);

    if (result.success) {
      // Send test notification to confirm setup
      await notificationService.sendMultiChannelNotification(userId, 'account_updates', {
        title: 'Notifications Enabled!',
        body: 'You\'ll now receive important updates and alerts on this device.',
        icon: 'notification_icon'
      }, {
        type: 'notification_setup_complete',
        action: 'none'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Device token registered successfully'
    });

  } catch (error) {
    logger.error('Add device token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Remove device token
const removeDeviceToken = async (req, res) => {
  try {
    const { deviceToken } = req.body;
    const userId = req.user.id;

    if (!deviceToken) {
      return res.status(400).json({
        success: false,
        message: 'Device token is required'
      });
    }

    await notificationService.removeDeviceToken(userId, deviceToken);

    res.status(200).json({
      success: true,
      message: 'Device token removed successfully'
    });

  } catch (error) {
    logger.error('Remove device token error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get notification preferences
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await NotificationPreferences.getPreferences(userId);

    res.status(200).json({
      success: true,
      data: preferences
    });

  } catch (error) {
    logger.error('Get preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update notification preferences
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = req.body;

    const preferences = await NotificationPreferences.getPreferences(userId);
    await preferences.updatePreferences(updates);

    logger.info(`Notification preferences updated for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Notification preferences updated successfully',
      data: preferences
    });

  } catch (error) {
    logger.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user notifications (inbox)
const getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const whereClause = { user_id: userId };
    if (unreadOnly === 'true') {
      whereClause.is_read = false;
    }

    const offset = (page - 1) * limit;

    const notifications = await Notification.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.status(200).json({
      success: true,
      data: {
        notifications: notifications.rows,
        pagination: {
          total: notifications.count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(notifications.count / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Mark notification as read
const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOne({
      where: {
        id: notificationId,
        user_id: userId
      }
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.update({ is_read: true });

    res.status(200).json({
      success: true,
      message: 'Notification marked as read'
    });

  } catch (error) {
    logger.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Mark all notifications as read
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.update(
      { is_read: true },
      {
        where: {
          user_id: userId,
          is_read: false
        }
      }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    logger.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get unread notification count
const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const count = await Notification.count({
      where: {
        user_id: userId,
        is_read: false
      }
    });

    res.status(200).json({
      success: true,
      data: { unreadCount: count }
    });

  } catch (error) {
    logger.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Send test notification (for testing purposes)
const sendTestNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = 'account_updates', title, body } = req.body;

    const result = await notificationService.sendMultiChannelNotification(userId, type, {
      title: title || 'Test Notification',
      body: body || 'This is a test notification to verify your notification settings.',
      icon: 'test_icon'
    }, {
      type: 'test_notification',
      timestamp: new Date().toISOString()
    });

    res.status(200).json({
      success: true,
      message: 'Test notification sent',
      results: result.results
    });

  } catch (error) {
    logger.error('Send test notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Trigger specific registration flow notifications (for manual testing/support)
const triggerRegistrationNotification = async (req, res) => {
  try {
    const { type } = req.params;
    const userId = req.user.id;
    const userName = req.user.first_name;

    let result;

    switch (type) {
      case 'welcome':
        result = await notificationService.sendRegistrationWelcome(userId, userName);
        break;
      case 'email_verification':
        result = await notificationService.sendEmailVerificationReminder(userId);
        break;
      case 'phone_verification':
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        result = await notificationService.sendPhoneVerificationCode(userId, verificationCode);
        break;
      case 'kyc_approved':
        result = await notificationService.sendKYCStatusUpdate(userId, 'approved', 'Your KYC verification has been approved! You can now access all trading features.');
        break;
      case 'account_activated':
        result = await notificationService.sendAccountActivated(userId, userName);
        break;
      case 'biometric_setup':
        result = await notificationService.sendBiometricSetupComplete(userId);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid notification type'
        });
    }

    res.status(200).json({
      success: true,
      message: `${type} notification triggered`,
      result: result
    });

  } catch (error) {
    logger.error('Trigger notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get notification system statistics (admin/monitoring)
const getSystemStats = async (req, res) => {
  try {
    const [
      realtimeStats,
      batchStats,
      dedupeStats
    ] = await Promise.all([
      realtimeNotificationService.getStats(),
      Promise.resolve(batchNotificationProcessor.getStats()),
      notificationDeduplicationService.getStats()
    ]);

    res.status(200).json({
      success: true,
      data: {
        realtime: realtimeStats,
        batch: batchStats,
        deduplication: dedupeStats,
        firebase: {
          initialized: pushNotificationService.isInitialized
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Get system stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Subscribe device to topic (for group notifications)
const subscribeToTopic = async (req, res) => {
  try {
    const { deviceToken, topic } = req.body;

    if (!deviceToken || !topic) {
      return res.status(400).json({
        success: false,
        message: 'Device token and topic are required'
      });
    }

    const result = await pushNotificationService.subscribeToTopic(deviceToken, topic);

    res.status(200).json({
      success: result.success,
      message: result.success ? 'Subscribed to topic successfully' : result.error
    });

  } catch (error) {
    logger.error('Subscribe to topic error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Send notification to specific user (new real-time system)
const sendRealtimeNotification = async (req, res) => {
  try {
    const { userId, event, payload, options } = req.body;

    if (!userId || !event || !payload) {
      return res.status(400).json({
        success: false,
        message: 'userId, event, and payload are required'
      });
    }

    const result = await realtimeNotificationService.sendToUser(
      userId,
      event,
      payload,
      options || {}
    );

    res.status(200).json({
      success: result.success,
      data: result
    });

  } catch (error) {
    logger.error('Send realtime notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Broadcast notification to all users
const broadcastNotification = async (req, res) => {
  try {
    const { event, payload } = req.body;

    if (!event || !payload) {
      return res.status(400).json({
        success: false,
        message: 'event and payload are required'
      });
    }

    await realtimeNotificationService.broadcastToAll(event, payload);

    res.status(200).json({
      success: true,
      message: 'Broadcast sent successfully'
    });

  } catch (error) {
    logger.error('Broadcast notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user's recent alert history
const getAlertHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { minutes = 60 } = req.query;

    const alerts = await notificationDeduplicationService.getUserRecentAlerts(
      userId,
      parseInt(minutes)
    );

    res.status(200).json({
      success: true,
      data: {
        alerts,
        timeWindow: `${minutes} minutes`,
        count: alerts.length
      }
    });

  } catch (error) {
    logger.error('Get alert history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Clean up old user alerts
const cleanupUserAlerts = async (req, res) => {
  try {
    const userId = req.user.id;
    const { olderThanMinutes = 1440 } = req.query; // Default 24 hours

    const removed = await notificationDeduplicationService.cleanupUserAlerts(
      userId,
      parseInt(olderThanMinutes)
    );

    res.status(200).json({
      success: true,
      message: 'Alert cleanup completed',
      data: { removed }
    });

  } catch (error) {
    logger.error('Cleanup alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Health check endpoint for notification system
const healthCheck = async (req, res) => {
  try {
    const redisService = require('../config/redis');
    const websocketService = require('../services/websocketService');

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        redis: {
          connected: redisService.isConnected,
          status: redisService.isConnected ? 'up' : 'down'
        },
        websocket: {
          connected: websocketService.io ? true : false,
          activeConnections: websocketService.connectedClients?.size || 0,
          status: websocketService.io ? 'up' : 'down'
        },
        firebase: {
          initialized: pushNotificationService.isInitialized,
          status: pushNotificationService.isInitialized ? 'up' : 'down'
        },
        realtimeNotification: {
          initialized: realtimeNotificationService.isInitialized,
          status: realtimeNotificationService.isInitialized ? 'up' : 'down'
        },
        batchProcessor: {
          running: batchNotificationProcessor.isProcessing,
          queueSize: batchNotificationProcessor.getStats().queues.total,
          status: batchNotificationProcessor.isProcessing ? 'up' : 'down'
        }
      }
    };

    // Check if any critical service is down
    const criticalServices = ['redis', 'websocket', 'realtimeNotification'];
    const anyCriticalDown = criticalServices.some(
      service => health.services[service].status === 'down'
    );

    if (anyCriticalDown) {
      health.status = 'degraded';
      res.status(503);
    } else {
      res.status(200);
    }

    res.json({
      success: true,
      data: health
    });

  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      message: error.message
    });
  }
};

module.exports = {
  addDeviceToken,
  removeDeviceToken,
  getPreferences,
  updatePreferences,
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  sendTestNotification,
  triggerRegistrationNotification,
  // New endpoints for enhanced notification system
  getSystemStats,
  subscribeToTopic,
  sendRealtimeNotification,
  broadcastNotification,
  getAlertHistory,
  cleanupUserAlerts,
  healthCheck
};