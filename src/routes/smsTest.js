const express = require('express');
const smsService = require('../services/smsService');
const testSmsService = require('../services/testSmsService');
const logger = require('../utils/logger');

const router = express.Router();

// Test SMS endpoint - for development/testing only
router.post('/test', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and message are required'
      });
    }

    logger.info('Testing SMS service:', { phoneNumber, messageLength: message.length });

    const result = await smsService.sendSMS(phoneNumber, message);

    res.json({
      success: result.success,
      result: result,
      provider: process.env.SMS_PROVIDER || 'testsms'
    });

  } catch (error) {
    logger.error('SMS test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test verification code SMS
router.post('/test-verification', async (req, res) => {
  try {
    const { phoneNumber, userName } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    logger.info('Testing verification SMS:', { phoneNumber, code: verificationCode });

    const result = await smsService.sendVerificationCode(phoneNumber, verificationCode, userName || 'User');

    res.json({
      success: result.success,
      result: result,
      verificationCode: verificationCode, // Only for testing
      provider: process.env.SMS_PROVIDER || 'testsms'
    });

  } catch (error) {
    logger.error('SMS verification test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test TestSMS balance
router.get('/balance', async (req, res) => {
  try {
    const result = await testSmsService.getBalance();

    res.json({
      success: result.success,
      balance: result.balance || 'Unknown',
      provider: 'testsms'
    });

  } catch (error) {
    logger.error('Balance check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test TestSMS connection
router.get('/test-connection', async (req, res) => {
  try {
    const result = await testSmsService.testConnection();

    res.json({
      success: result.success,
      result: result,
      provider: 'testsms'
    });

  } catch (error) {
    logger.error('Connection test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;