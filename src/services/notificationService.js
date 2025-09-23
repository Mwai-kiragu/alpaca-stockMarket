const pushNotificationService = require('./pushNotificationService');
const smsService = require('./smsService');
const emailService = require('./emailService');
const { User, Notification } = require('../models');
const NotificationPreferences = require('../models/NotificationPreferences');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.channels = {
      push: pushNotificationService,
      sms: smsService,
      email: emailService
    };
  }

  async sendMultiChannelNotification(userId, notificationType, notification, data = {}) {
    try {
      const user = await User.findByPk(userId, {
        attributes: ['id', 'first_name', 'last_name', 'email', 'phone']
      });

      if (!user) {
        logger.error(`User not found for notification: ${userId}`);
        return { success: false, error: 'User not found' };
      }

      const preferences = await NotificationPreferences.getPreferences(userId);
      const results = {};

      // Store notification in database
      await this.storeNotification(userId, notificationType, notification, data);

      // Send push notification
      if (preferences.shouldSendNotification(notificationType, 'push')) {
        results.push = await this.sendPushNotification(preferences, notification, data);
      }

      // Send SMS notification (for critical notifications)
      if (this.isCriticalNotification(notificationType) &&
          preferences.shouldSendNotification(notificationType, 'sms')) {
        results.sms = await this.sendSMSNotification(user, notificationType, notification, data);
      }

      // Send email notification
      if (preferences.shouldSendNotification(notificationType, 'email')) {
        results.email = await this.sendEmailNotification(user, notificationType, notification, data);
      }

      logger.info(`Multi-channel notification sent for user ${userId}`, {
        type: notificationType,
        channels: Object.keys(results)
      });

      return { success: true, results };

    } catch (error) {
      logger.error('Multi-channel notification error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendPushNotification(preferences, notification, data) {
    if (!preferences.device_tokens || preferences.device_tokens.length === 0) {
      return { success: false, error: 'No device tokens available' };
    }

    return pushNotificationService.sendPushNotification(
      preferences.device_tokens,
      notification,
      data
    );
  }

  async sendSMSNotification(user, type, notification, data) {
    if (!user.phone) {
      return { success: false, error: 'No phone number available' };
    }

    const smsMessage = this.formatSMSMessage(type, notification, data, user.first_name);
    return smsService.sendSMS(user.phone, smsMessage);
  }

  async sendEmailNotification(user, type, notification, data) {
    if (!user.email) {
      return { success: false, error: 'No email address available' };
    }

    // Use existing email service methods based on notification type
    switch (type) {
      case 'account_updates':
        return emailService.sendAccountUpdateEmail ?
          emailService.sendAccountUpdateEmail(user, notification, data) :
          { success: false, error: 'Email method not available' };
      case 'security_alerts':
        return emailService.sendSecurityAlertEmail ?
          emailService.sendSecurityAlertEmail(user, notification, data) :
          { success: false, error: 'Email method not available' };
      case 'kyc_updates':
        return emailService.sendKYCUpdateEmail ?
          emailService.sendKYCUpdateEmail(user, notification, data) :
          { success: false, error: 'Email method not available' };
      default:
        return emailService.sendGenericNotificationEmail ?
          emailService.sendGenericNotificationEmail(user, notification, data) :
          { success: false, error: 'Email method not available' };
    }
  }

  formatSMSMessage(type, notification, data, userName) {
    const prefix = `Hi ${userName}, `;

    switch (type) {
      case 'security_alerts':
        return `RIVEN Security Alert: ${notification.body}`;
      case 'transaction_alerts':
        return `${prefix}${notification.body}`;
      case 'kyc_updates':
        return `${prefix}${notification.body} Check the app for details.`;
      default:
        return `${prefix}${notification.body}`;
    }
  }

  isCriticalNotification(type) {
    const criticalTypes = [
      'security_alerts',
      'account_updates',
      'kyc_updates',
      'transaction_alerts'
    ];
    return criticalTypes.includes(type);
  }

  async storeNotification(userId, type, notification, data) {
    return Notification.create({
      user_id: userId,
      type: type,
      title: notification.title,
      message: notification.body,
      data: data,
      is_read: false,
      sent_at: new Date()
    });
  }

  // Registration flow notifications
  async sendRegistrationWelcome(userId, userName) {
    return this.sendMultiChannelNotification(userId, 'promotional', {
      title: 'Welcome to RIVEN!',
      body: `Hi ${userName}! Your account has been created successfully. Complete your profile to start trading.`,
      icon: 'welcome_icon'
    }, {
      type: 'registration_welcome',
      action: 'complete_profile'
    });
  }

  async sendEmailVerificationReminder(userId) {
    return this.sendMultiChannelNotification(userId, 'account_updates', {
      title: 'Email Verification Required',
      body: 'Please verify your email address to continue with your account setup.',
      icon: 'email_icon'
    }, {
      type: 'email_verification_reminder',
      action: 'verify_email'
    });
  }

  async sendPhoneVerificationCode(userId, verificationCode) {
    const user = await User.findByPk(userId, {
      attributes: ['first_name', 'phone']
    });

    if (user && user.phone) {
      return smsService.sendVerificationCode(user.phone, verificationCode, user.first_name);
    }

    return { success: false, error: 'User phone number not found' };
  }

  async sendKYCStatusUpdate(userId, status, message) {
    const statusTitles = {
      'approved': 'KYC Approved ✓',
      'rejected': 'KYC Documents Required',
      'under_review': 'KYC Under Review',
      'submitted': 'KYC Documents Received'
    };

    return this.sendMultiChannelNotification(userId, 'kyc_updates', {
      title: statusTitles[status] || 'KYC Update',
      body: message,
      icon: 'kyc_icon'
    }, {
      type: 'kyc_status_update',
      status: status,
      action: 'view_kyc_status'
    });
  }

  async sendBiometricSetupComplete(userId) {
    return this.sendMultiChannelNotification(userId, 'security_alerts', {
      title: 'Biometric Authentication Enabled',
      body: 'Your account is now secured with biometric authentication for enhanced security.',
      icon: 'security_icon'
    }, {
      type: 'biometric_setup_complete',
      action: 'security_settings'
    });
  }

  async sendAccountActivated(userId, userName) {
    return this.sendMultiChannelNotification(userId, 'account_updates', {
      title: 'Account Activated!',
      body: `Congratulations ${userName}! Your RIVEN account is now fully activated. You can start trading immediately.`,
      icon: 'success_icon'
    }, {
      type: 'account_activated',
      action: 'start_trading'
    });
  }

  // Device management
  async addDeviceToken(userId, deviceToken) {
    try {
      const preferences = await NotificationPreferences.getPreferences(userId);
      const currentTokens = preferences.device_tokens || [];

      if (!currentTokens.includes(deviceToken)) {
        currentTokens.push(deviceToken);
        await preferences.updatePreferences({ device_tokens: currentTokens });

        // Subscribe to user topics
        await pushNotificationService.subscribeToTopic(deviceToken, `user_${userId}`);
        await pushNotificationService.subscribeToTopic(deviceToken, 'all_users');

        logger.info(`Device token added for user ${userId}`);
      }

      return { success: true };
    } catch (error) {
      logger.error('Add device token error:', error);
      return { success: false, error: error.message };
    }
  }

  async removeDeviceToken(userId, deviceToken) {
    try {
      const preferences = await NotificationPreferences.getPreferences(userId);
      const currentTokens = preferences.device_tokens || [];
      const updatedTokens = currentTokens.filter(token => token !== deviceToken);

      await preferences.updatePreferences({ device_tokens: updatedTokens });

      logger.info(`Device token removed for user ${userId}`);
      return { success: true };
    } catch (error) {
      logger.error('Remove device token error:', error);
      return { success: false, error: error.message };
    }
  }

  // Bulk notifications
  async sendBulkNotification(userIds, notificationType, notification, data = {}) {
    const results = [];

    for (const userId of userIds) {
      try {
        const result = await this.sendMultiChannelNotification(userId, notificationType, notification, data);
        results.push({ userId, ...result });

        // Add delay to prevent overwhelming the services
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        results.push({ userId, success: false, error: error.message });
      }
    }

    return {
      success: true,
      totalSent: results.filter(r => r.success).length,
      totalFailed: results.filter(r => !r.success).length,
      results
    };
  }
}

module.exports = new NotificationService();