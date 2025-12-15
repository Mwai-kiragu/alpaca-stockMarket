const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  getWallet,
  unfreezeWallet,
  getTransactions,
  checkDepositStatus,
  convertCurrency,
  initiateWithdrawal,
  processWithdrawal,
  getWithdrawalStatus,
  getCurrentExchangeRates,
  getSpecificRate,
  updateAutoConvertPreference,
  getAutoConvertPreference
} = require('../controllers/walletController');
const {
  getWalletWithAnalytics,
  getAdvancedTransactions,
  getForexRates,
  simulateConversion,
  getWalletInsights,
  bulkConvertCurrency
} = require('../controllers/enhancedWalletController');
const { auth } = require('../middleware/auth');
const { depositValidation, paginationValidation, withdrawalValidation } = require('../middleware/validation');

const router = express.Router();

// Rate limiters for withdrawals
const withdrawalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 3, // Max 3 withdrawal attempts per minute
  keyGenerator: (req) => req.user?.id || req.ip, // Rate limit per user
  message: {
    success: false,
    message: 'Too many withdrawal attempts. Please wait 1 minute before trying again.',
    statusCode: 429
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limit for large withdrawals (applied in controller)
const largeWithdrawalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 large withdrawals per hour
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    message: 'Too many large withdrawals. Please try again later.',
    statusCode: 429
  },
  skip: (req) => {
    // Only apply to withdrawals over 10,000 KES or 100 USD
    const amount = parseFloat(req.body?.amount) || 0;
    const currency = req.body?.currency;
    return currency === 'KES' ? amount < 10000 : amount < 100;
  }
});

// Basic wallet endpoints
router.get('/', auth, getWallet);
router.post('/unfreeze', auth, unfreezeWallet);
router.get('/transactions', auth, paginationValidation, getTransactions);

// Deposit endpoints - DEPRECATED
// Old M-Pesa Direct endpoints removed - Use KCB M-Pesa STK Push instead at /api/v1/kcb/stkpush
// router.post('/deposit', auth, depositValidation, initiateDeposit);
// router.post('/mpesa/callback/:reference', mpesaCallback);
// router.post('/mpesa/callback', mpesaCallback);
router.get('/deposit/status/:reference', auth, checkDepositStatus);

// Withdrawal endpoints (rate limited)
router.post('/withdraw', auth, withdrawalLimiter, largeWithdrawalLimiter, withdrawalValidation, initiateWithdrawal);
router.post('/withdraw/process/:reference', auth, processWithdrawal); // Admin endpoint
router.get('/withdraw/status/:reference', auth, getWithdrawalStatus);

// Currency conversion
router.post('/convert', auth, convertCurrency);

// Exchange rates endpoints
router.get('/rates', auth, getCurrentExchangeRates);
router.get('/rates/:from/:to', auth, getSpecificRate);

// Auto-conversion preferences
router.get('/auto-convert', auth, getAutoConvertPreference);
router.put('/auto-convert', auth, updateAutoConvertPreference);

// Enhanced wallet endpoints
router.get('/analytics', auth, getWalletWithAnalytics);
router.get('/transactions/advanced', auth, getAdvancedTransactions);
router.get('/forex/rates', auth, getForexRates);
router.post('/forex/simulate', auth, simulateConversion);
router.get('/insights', auth, getWalletInsights);
router.post('/convert/bulk', auth, bulkConvertCurrency);

module.exports = router;