const express = require('express');
const { auth } = require('../../middleware/auth');
const {
  listBonds, getBond, subscribeToBond,
  listFunds, getFund, subscribeToFund, redeemFund
} = require('../../controllers/mystocks/msBondFundController');

const router = express.Router();

router.get('/bonds', auth, listBonds);
router.get('/bonds/:bondId', auth, getBond);
router.post('/bonds/subscribe', auth, subscribeToBond);

router.get('/funds', auth, listFunds);
router.get('/funds/:fundId', auth, getFund);
router.post('/funds/subscribe', auth, subscribeToFund);
router.post('/funds/redeem', auth, redeemFund);

module.exports = router;
