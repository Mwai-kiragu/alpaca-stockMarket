const express = require('express');
const {
  getAccountInfo,
  getAccountActivity,
  getAccountConfigurations,
  updateAccountConfigurations,
  getTradeHistory,
  getAccountDocuments
} = require('../controllers/accountController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getAccountInfo);
router.get('/activity', auth, getAccountActivity);
router.get('/configurations', auth, getAccountConfigurations);
router.patch('/configurations', auth, updateAccountConfigurations);
router.get('/trades', auth, getTradeHistory);
router.get('/documents', auth, getAccountDocuments);

module.exports = router;