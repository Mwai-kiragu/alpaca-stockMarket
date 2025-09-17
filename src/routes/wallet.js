const express = require('express');
const {
  getWallet,
  getTransactions,
  initiateDeposit,
  mpesaCallback,
  checkDepositStatus,
  convertCurrency
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
const { depositValidation, paginationValidation } = require('../middleware/validation');

const router = express.Router();

// Basic wallet endpoints
router.get('/', auth, getWallet);
router.get('/transactions', auth, paginationValidation, getTransactions);
router.post('/deposit', auth, depositValidation, initiateDeposit);
router.post('/mpesa/callback/:reference', mpesaCallback);
router.get('/deposit/status/:reference', auth, checkDepositStatus);
router.post('/convert', auth, convertCurrency);

// Enhanced wallet endpoints
router.get('/analytics', auth, getWalletWithAnalytics);
router.get('/transactions/advanced', auth, getAdvancedTransactions);
router.get('/forex/rates', auth, getForexRates);
router.post('/forex/simulate', auth, simulateConversion);
router.get('/insights', auth, getWalletInsights);
router.post('/convert/bulk', auth, bulkConvertCurrency);

module.exports = router;