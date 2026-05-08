const express = require('express');
const { auth } = require('../../middleware/auth');
const { getWallet, deposit, withdraw, getTransactions } = require('../../controllers/mystocks/msWalletController');

const router = express.Router();

router.get('/wallet', auth, getWallet);
router.post('/wallet/deposit', auth, deposit);
router.post('/wallet/withdraw', auth, withdraw);
router.get('/wallet/transactions', auth, getTransactions);

module.exports = router;
