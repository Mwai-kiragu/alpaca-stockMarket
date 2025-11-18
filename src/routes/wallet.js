const express = require('express');
const {
  getWallet,
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

// Basic wallet endpoints
router.get('/', auth, getWallet);
router.get('/transactions', auth, paginationValidation, getTransactions);

// Deposit endpoints - DEPRECATED
// Old M-Pesa Direct endpoints removed - Use KCB M-Pesa STK Push instead at /api/v1/kcb/stkpush
// router.post('/deposit', auth, depositValidation, initiateDeposit);
// router.post('/mpesa/callback/:reference', mpesaCallback);
// router.post('/mpesa/callback', mpesaCallback);
router.get('/deposit/status/:reference', auth, checkDepositStatus);

// Withdrawal endpoints
router.post('/withdraw', auth, withdrawalValidation, initiateWithdrawal);
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