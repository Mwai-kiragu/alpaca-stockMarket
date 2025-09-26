const axios = require('axios');
const logger = require('../utils/logger');

class TestSmsService {
  constructor() {
    this.baseUrl = 'https://testsms.co.ke';
    this.username = 'Riven';
    this.password = 'RivenApp#1926';
    this.sender = 'RIVEN'; // Your sender ID
  }

  /**
   * Send SMS via TestSMS API
   * @param {string} phoneNumber - Phone number in international format (e.g., +254712345678)
   * @param {string} message - SMS message content
   * @returns {Promise<Object>} - API response
   */
  async sendSMS(phoneNumber, message) {
    try {
      // Format phone number - TestSMS expects format without +
      const formattedPhone = phoneNumber.replace(/\+/g, '');

      const payload = {
        username: this.username,
        password: this.password,
        phone: formattedPhone,
        message: message,
        sender: this.sender
      };

      logger.info('Sending SMS via TestSMS:', {
        phone: formattedPhone,
        messageLength: message.length,
        sender: this.sender
      });

      const response = await axios.post(`${this.baseUrl}/api/services/sendsms/`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.data && response.data.status === 'success') {
        logger.info('SMS sent successfully via TestSMS:', {
          phone: formattedPhone,
          messageId: response.data.message_id || 'N/A'
        });

        return {
          success: true,
          messageId: response.data.message_id,
          response: response.data
        };
      } else {
        logger.error('TestSMS API returned error:', response.data);
        return {
          success: false,
          error: response.data.message || 'Unknown error from TestSMS'
        };
      }

    } catch (error) {
      logger.error('TestSMS API error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to send SMS'
      };
    }
  }

  /**
   * Send verification code SMS
   * @param {string} phoneNumber - Phone number
   * @param {string} verificationCode - 6-digit verification code
   * @param {string} userName - User's first name
   * @returns {Promise<Object>} - API response
   */
  async sendVerificationCode(phoneNumber, verificationCode, userName = '') {
    const message = `Hi ${userName}! Your RIVEN verification code is: ${verificationCode}. This code expires in 10 minutes. Do not share this code with anyone.`;

    return this.sendSMS(phoneNumber, message);
  }

  /**
   * Send welcome SMS
   * @param {string} phoneNumber - Phone number
   * @param {string} userName - User's first name
   * @returns {Promise<Object>} - API response
   */
  async sendWelcomeSMS(phoneNumber, userName) {
    const message = `Welcome to RIVEN, ${userName}! Your account has been created successfully. Start trading US stocks today. Download our app or visit our website.`;

    return this.sendSMS(phoneNumber, message);
  }

  /**
   * Send transaction notification SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} transaction - Transaction details
   * @returns {Promise<Object>} - API response
   */
  async sendTransactionSMS(phoneNumber, transaction) {
    const { type, amount, status, symbol } = transaction;
    let message;

    if (type === 'buy' || type === 'sell') {
      message = `RIVEN: Your ${type.toUpperCase()} order for ${symbol} (${amount} shares) is ${status.toUpperCase()}. Check the app for details.`;
    } else {
      message = `RIVEN: Your ${type} transaction of $${amount} is ${status}. Check the app for details.`;
    }

    return this.sendSMS(phoneNumber, message);
  }

  /**
   * Send security alert SMS
   * @param {string} phoneNumber - Phone number
   * @param {string} alertMessage - Security alert message
   * @returns {Promise<Object>} - API response
   */
  async sendSecurityAlert(phoneNumber, alertMessage) {
    const message = `RIVEN SECURITY ALERT: ${alertMessage}. If this wasn't you, contact support immediately.`;

    return this.sendSMS(phoneNumber, message);
  }

  /**
   * Send KYC status update SMS
   * @param {string} phoneNumber - Phone number
   * @param {string} status - KYC status (approved, rejected, under_review)
   * @param {string} userName - User's first name
   * @returns {Promise<Object>} - API response
   */
  async sendKYCStatusSMS(phoneNumber, status, userName) {
    let message;

    switch (status) {
      case 'approved':
        message = `Hi ${userName}! Your RIVEN KYC verification has been APPROVED. You can now start trading. Welcome aboard!`;
        break;
      case 'rejected':
        message = `Hi ${userName}! Your RIVEN KYC documents need review. Please upload clear, valid documents via the app.`;
        break;
      case 'under_review':
        message = `Hi ${userName}! Your RIVEN KYC documents are under review. We'll notify you once processed (1-2 business days).`;
        break;
      default:
        message = `Hi ${userName}! Your RIVEN KYC status has been updated. Please check the app for details.`;
    }

    return this.sendSMS(phoneNumber, message);
  }

  /**
   * Test SMS connectivity
   * @returns {Promise<Object>} - Test result
   */
  async testConnection() {
    try {
      const testMessage = 'RIVEN: Test message from your trading platform. SMS service is working correctly.';
      const testPhone = '254700000000'; // Test number

      const result = await this.sendSMS(testPhone, testMessage);

      logger.info('TestSMS connection test result:', result);
      return result;
    } catch (error) {
      logger.error('TestSMS connection test failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get account balance (if supported by TestSMS API)
   * @returns {Promise<Object>} - Balance info
   */
  async getBalance() {
    try {
      // Note: Check TestSMS documentation for balance endpoint
      // This is a placeholder implementation
      const response = await axios.get(`${this.baseUrl}/api/services/balance/`, {
        params: {
          username: this.username,
          password: this.password
        },
        timeout: 5000
      });

      return {
        success: true,
        balance: response.data.balance || 'Unknown'
      };
    } catch (error) {
      logger.error('Failed to get TestSMS balance:', error.message);
      return {
        success: false,
        error: 'Unable to fetch balance'
      };
    }
  }
}

module.exports = new TestSmsService();