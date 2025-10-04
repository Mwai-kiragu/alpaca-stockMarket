const express = require('express');
const {
  getAccountInfo,
  getAccountActivity,
  getAccountConfigurations,
  updateAccountConfigurations,
  getTradeHistory,
  getAccountDocuments,
  updateAccount,
  deleteAccount
} = require('../controllers/accountController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getAccountInfo);
router.put('/', auth, updateAccount);  // Update account
router.delete('/', auth, deleteAccount);  // Delete account
router.get('/activity', auth, getAccountActivity);
router.get('/configurations', auth, getAccountConfigurations);
router.patch('/configurations', auth, updateAccountConfigurations);
router.get('/trades', auth, getTradeHistory);
router.get('/documents', auth, getAccountDocuments);

module.exports = router;