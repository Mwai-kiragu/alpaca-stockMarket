const admin = require('firebase-admin');
const logger = require('../utils/logger');

// Initialize Firebase Admin SDK (you'll need to add firebase-admin to package.json)
class PushNotificationService {
  constructor() {
    this.isInitialized = false;
    this.initialize();
  }

  async initialize() {
    try {
      if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.isInitialized = true;
        logger.info('Firebase Admin SDK initialized successfully');
      }
    } catch (error) {
      logger.error('Firebase initialization error:', error);
      this.isInitialized = false;
    }
  }

  async sendPushNotification(deviceTokens, notification, data = {}) {
    if (!this.isInitialized) {
      logger.warn('Firebase not initialized, skipping push notification');
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
      const validTokens = tokens.filter(token => token && token.length > 0);

      if (validTokens.length === 0) {
        return { success: false, error: 'No valid device tokens provided' };
      }

      const message = {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: notification.icon || 'default_icon',
          sound: notification.sound || 'default'
        },
        data: {
          ...data,
          timestamp: new Date().toISOString()
        },
        tokens: validTokens
      };

      if (notification.imageUrl) {
        message.notification.image = notification.imageUrl;
      }

      const response = await admin.messaging().sendMulticast(message);

      logger.info(`Push notification sent: ${response.successCount}/${validTokens.length} successful`);

      return {
        success: true,
        response: {
          successCount: response.successCount,
          failureCount: response.failureCount,
          responses: response.responses
        }
      };

    } catch (error) {
      logger.error('Push notification error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendWelcomeNotification(deviceTokens, userName) {
    return this.sendPushNotification(deviceTokens, {
      title: 'Welcome to RIVEN!',
      body: `Hi ${userName}! Your account has been created successfully. Start your trading journey now!`,
      icon: 'welcome_icon'
    }, {
      type: 'welcome',
      action: 'open_app'
    });
  }

  async sendEmailVerificationNotification(deviceTokens) {
    return this.sendPushNotification(deviceTokens, {
      title: 'Email Verification Required',
      body: 'Please check your email and verify your account to continue.',
      icon: 'email_icon'
    }, {
      type: 'email_verification',
      action: 'open_verification'
    });
  }

  async sendPhoneVerificationNotification(deviceTokens, verificationCode) {
    return this.sendPushNotification(deviceTokens, {
      title: 'Phone Verification Code',
      body: `Your verification code is: ${verificationCode}`,
      icon: 'phone_icon'
    }, {
      type: 'phone_verification',
      verification_code: verificationCode,
      action: 'auto_fill'
    });
  }

  async sendBiometricEnabledNotification(deviceTokens) {
    return this.sendPushNotification(deviceTokens, {
      title: 'Biometric Authentication Enabled',
      body: 'Your account is now secured with biometric authentication.',
      icon: 'security_icon'
    }, {
      type: 'biometric_enabled',
      action: 'security_settings'
    });
  }

  async sendKYCStatusNotification(deviceTokens, status, message) {
    const titles = {
      'approved': 'KYC Approved ✓',
      'rejected': 'KYC Review Required',
      'under_review': 'KYC Under Review',
      'submitted': 'KYC Documents Received'
    };

    return this.sendPushNotification(deviceTokens, {
      title: titles[status] || 'KYC Update',
      body: message,
      icon: 'kyc_icon'
    }, {
      type: 'kyc_status',
      status: status,
      action: 'open_kyc'
    });
  }

  async sendSecurityAlertNotification(deviceTokens, alertType, deviceInfo) {
    const alerts = {
      'new_login': `New login detected from ${deviceInfo.device || 'unknown device'}`,
      'failed_login': 'Multiple failed login attempts detected on your account',
      'password_change': 'Your password has been changed successfully',
      'biometric_disabled': 'Biometric authentication has been disabled'
    };

    return this.sendPushNotification(deviceTokens, {
      title: 'Security Alert',
      body: alerts[alertType] || 'Security event detected on your account',
      icon: 'security_alert_icon',
      sound: 'security_alert'
    }, {
      type: 'security_alert',
      alert_type: alertType,
      device_info: deviceInfo,
      action: 'security_center'
    });
  }

  async sendTransactionNotification(deviceTokens, transaction) {
    const { type, amount, symbol, status } = transaction;
    const action = type === 'buy' ? 'purchased' : 'sold';

    return this.sendPushNotification(deviceTokens, {
      title: `${type.toUpperCase()} Order ${status}`,
      body: `Successfully ${action} ${amount} shares of ${symbol}`,
      icon: 'transaction_icon'
    }, {
      type: 'transaction',
      transaction_type: type,
      symbol: symbol,
      amount: amount,
      status: status,
      action: 'view_portfolio'
    });
  }

  async sendAccountStatusNotification(deviceTokens, status, message) {
    const statusColors = {
      'active': '✓',
      'suspended': '⚠️',
      'closed': '❌'
    };

    return this.sendPushNotification(deviceTokens, {
      title: `Account ${status.toUpperCase()} ${statusColors[status] || ''}`,
      body: message,
      icon: 'account_icon'
    }, {
      type: 'account_status',
      status: status,
      action: 'account_settings'
    });
  }

  // Topic-based notifications for user segments
  async subscribeToTopic(deviceToken, topic) {
    if (!this.isInitialized) return { success: false, error: 'Firebase not initialized' };

    try {
      await admin.messaging().subscribeToTopic(deviceToken, topic);
      logger.info(`Device subscribed to topic: ${topic}`);
      return { success: true };
    } catch (error) {
      logger.error('Topic subscription error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendTopicNotification(topic, notification, data = {}) {
    if (!this.isInitialized) return { success: false, error: 'Firebase not initialized' };

    try {
      const message = {
        notification,
        data,
        topic: topic
      };

      const response = await admin.messaging().send(message);
      logger.info(`Topic notification sent to ${topic}:`, response);
      return { success: true, messageId: response };
    } catch (error) {
      logger.error('Topic notification error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new PushNotificationService();