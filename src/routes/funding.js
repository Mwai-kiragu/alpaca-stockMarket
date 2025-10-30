const express = require('express');
const {
  syncToAlpaca,
  syncFromAlpaca,
  getFundingWalletStatus,
  getAlpacaTransfers,
  createBankAccount,
  getBankAccounts
} = require('../controllers/fundingController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Sync funds between wallet and Alpaca
router.post('/sync-to-alpaca', auth, syncToAlpaca);
router.post('/sync-from-alpaca', auth, syncFromAlpaca);

// Funding wallet status
router.get('/wallet-status', auth, getFundingWalletStatus);

// Transfer history
router.get('/transfers', auth, getAlpacaTransfers);

// Bank account management (for production)
router.post('/bank-accounts', auth, createBankAccount);
router.get('/bank-accounts', auth, getBankAccounts);

module.exports = router;
