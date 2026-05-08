const express = require('express');
const {
  depositFromBank,
  withdrawToBank,
  getTransactionStatus,
  validateAccount,
  initiateSTKPush,
  withdrawFromWallet,
  queryWithdrawalStatus,
  checkDepositStatus
} = require('../controllers/kcbController');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.post('/deposit', auth, depositFromBank);
router.post('/withdraw', auth, withdrawToBank);
router.post('/wallet/withdraw', auth, withdrawFromWallet);
router.get('/wallet/withdraw/:transactionReference', auth, queryWithdrawalStatus);
router.post('/stkpush', auth, initiateSTKPush);
router.get('/stkpush/status/:messageId', auth, checkDepositStatus);
router.get('/transaction/:transactionReference', auth, getTransactionStatus);
router.post('/validate-account', auth, validateAccount);

module.exports = router;
