const axios = require('axios');
const logger = require('../utils/logger');

class SMSService {
  constructor() {
    // Support multiple SMS providers: twilio, africastalking, testsms
    this.provider = process.env.SMS_PROVIDER || 'testsms';
    this.initialized = this.initialize();
  }

  initialize() {
    switch (this.provider) {
      case 'twilio':
        this.twilioClient = require('twilio')(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );
        break;
      case 'africastalking':
        this.africasTalking = require('africastalking')({
          apiKey: process.env.AFRICASTALKING_API_KEY,
          username: process.env.AFRICASTALKING_USERNAME
        });
        break;
      case 'testsms':
        this.testSmsService = require('./testSmsService');
        break;
      default:
        logger.warn('No SMS provider configured');
        return false;
    }
    return true;
  }

  async sendSMS(phoneNumber, message, options = {}) {
    if (!this.initialized) {
      logger.warn('SMS service not initialized');
      return { success: false, error: 'SMS service not configured' };
    }

    try {
      let result;

      switch (this.provider) {
        case 'twilio':
          result = await this.sendTwilioSMS(phoneNumber, message, options);
          break;
        case 'africastalking':
          result = await this.sendAfricasTalkingSMS(phoneNumber, message, options);
          break;
        case 'testsms':
          result = await this.sendTestSMS(phoneNumber, message, options);
          break;
        default:
          return { success: false, error: 'Unsupported SMS provider' };
      }

      logger.info(`SMS sent to ${phoneNumber} via ${this.provider}`, {
        messageId: result.messageId,
        status: result.status
      });

      return result;

    } catch (error) {
      logger.error('SMS sending error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendTwilioSMS(phoneNumber, message, options) {
    const messageOptions = {
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
      ...options
    };

    const result = await this.twilioClient.messages.create(messageOptions);

    return {
      success: true,
      messageId: result.sid,
      status: result.status,
      provider: 'twilio'
    };
  }

  async sendAfricasTalkingSMS(phoneNumber, message, options) {
    const sms = this.africasTalking.SMS;
    const messageOptions = {
      to: phoneNumber,
      message: message,
      from: process.env.AFRICASTALKING_SHORT_CODE,
      ...options
    };

    const result = await sms.send(messageOptions);

    return {
      success: result.SMSMessageData.Recipients[0].status === 'Success',
      messageId: result.SMSMessageData.Recipients[0].messageId,
      status: result.SMSMessageData.Recipients[0].status,
      cost: result.SMSMessageData.Recipients[0].cost,
      provider: 'africastalking'
    };
  }

  async sendTestSMS(phoneNumber, message, options) {
    const result = await this.testSmsService.sendSMS(phoneNumber, message);

    return {
      success: result.success,
      messageId: result.messageId || null,
      status: result.success ? 'sent' : 'failed',
      provider: 'testsms',
      error: result.error || null
    };
  }

  async sendVerificationCode(phoneNumber, code, userName = '') {
    const message = `Hi${userName ? ' ' + userName : ''}! Your RIVEN verification code is: ${code}. This code expires in 15 minutes. Do not share this code with anyone.`;

    return this.sendSMS(phoneNumber, message, {
      validityPeriod: 900 // 15 minutes
    });
  }

  async sendWelcomeSMS(phoneNumber, userName) {
    const message = `Welcome to RIVEN, ${userName}! Your trading account is now active. Download our mobile app to start trading on the go. Support: help@riven.com`;

    return this.sendSMS(phoneNumber, message);
  }

  async sendSecurityAlert(phoneNumber, alertType, details = {}) {
    const alerts = {
      'new_login': `RIVEN Security Alert: New login detected on your account from ${details.location || 'unknown location'}. If this wasn't you, contact support immediately.`,
      'password_change': 'RIVEN Security Alert: Your password has been changed successfully. If you didn\'t make this change, contact support immediately.',
      'account_locked': 'RIVEN Security Alert: Your account has been temporarily locked due to suspicious activity. Contact support to unlock.',
      'biometric_enabled': 'RIVEN Security: Biometric authentication has been enabled on your account for enhanced security.',
      'withdrawal_request': `RIVEN Alert: Withdrawal request of $${details.amount || '0'} initiated. If not authorized by you, contact support immediately.`
    };

    const message = alerts[alertType] || 'RIVEN Security Alert: Important activity detected on your account.';

    return this.sendSMS(phoneNumber, message, {
      priority: 'high'
    });
  }

  async sendKYCStatusSMS(phoneNumber, status, userName) {
    const messages = {
      'submitted': `Hi ${userName}, your KYC documents have been received and are under review. We'll notify you once the review is complete.`,
      'approved': `Great news ${userName}! Your KYC verification is approved. You can now access all RIVEN trading features.`,
      'rejected': `Hi ${userName}, your KYC documents need to be resubmitted. Please check your email for details and resubmit.`,
      'under_review': `Hi ${userName}, your KYC documents are currently under review. This typically takes 1-3 business days.`
    };

    const message = messages[status] || `Hi ${userName}, there's an update on your KYC status. Please check the app for details.`;

    return this.sendSMS(phoneNumber, message);
  }

  async sendAccountStatusSMS(phoneNumber, status, userName, reason = '') {
    const messages = {
      'active': `Hi ${userName}, your RIVEN account is now active! Start trading with confidence.`,
      'suspended': `Hi ${userName}, your RIVEN account has been temporarily suspended${reason ? ': ' + reason : ''}. Contact support for assistance.`,
      'closed': `Hi ${userName}, your RIVEN account has been closed${reason ? ': ' + reason : ''}. Contact support if you have questions.`
    };

    const message = messages[status] || `Hi ${userName}, there's an update on your account status. Please check the app.`;

    return this.sendSMS(phoneNumber, message);
  }

  async sendTransactionSMS(phoneNumber, transaction, userName) {
    const { type, symbol, quantity, amount, status } = transaction;
    const action = type === 'buy' ? 'purchased' : 'sold';

    let message;
    if (status === 'executed') {
      message = `Hi ${userName}, your ${type.toUpperCase()} order has been executed: ${action} ${quantity} shares of ${symbol} for $${amount}.`;
    } else if (status === 'cancelled') {
      message = `Hi ${userName}, your ${type.toUpperCase()} order for ${quantity} shares of ${symbol} has been cancelled.`;
    } else {
      message = `Hi ${userName}, your ${type.toUpperCase()} order for ${quantity} shares of ${symbol} is ${status}.`;
    }

    return this.sendSMS(phoneNumber, message);
  }

  async sendMarginCallSMS(phoneNumber, userName, details) {
    const message = `URGENT: Hi ${userName}, margin call issued. Your account equity is below required maintenance margin of $${details.maintenanceMargin}. Please deposit funds or close positions immediately.`;

    return this.sendSMS(phoneNumber, message, {
      priority: 'urgent'
    });
  }

  async sendMaintenanceSMS(phoneNumber, startTime, endTime) {
    const message = `RIVEN Maintenance Notice: Our services will be temporarily unavailable from ${startTime} to ${endTime} for scheduled maintenance. We apologize for any inconvenience.`;

    return this.sendSMS(phoneNumber, message);
  }

  // Bulk SMS functionality
  async sendBulkSMS(phoneNumbers, message, options = {}) {
    const results = [];

    for (const phoneNumber of phoneNumbers) {
      try {
        const result = await this.sendSMS(phoneNumber, message, options);
        results.push({ phoneNumber, ...result });

        // Add delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        results.push({
          phoneNumber,
          success: false,
          error: error.message
        });
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

module.exports = new SMSService();