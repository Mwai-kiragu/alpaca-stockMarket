const express = require('express');
const { auth } = require('../../middleware/auth');
const {
  listBonds, getBond, subscribeToBond,
  listFunds, getFund, subscribeToFund, redeemFund,
  listMarketIntel, getMarketIntelArticle
} = require('../../controllers/mystocks/msBondFundController');

const router = express.Router();

router.get('/bonds', auth, listBonds);
router.get('/bonds/:bondId', auth, getBond);
router.post('/bonds/subscribe', auth, subscribeToBond);

router.get('/funds', auth, listFunds);
router.get('/funds/:fundId', auth, getFund);
router.post('/funds/subscribe', auth, subscribeToFund);
router.post('/funds/redeem', auth, redeemFund);

// Market Intelligence (African news feed)
router.get('/news', auth, listMarketIntel);
router.get('/news/:idOrSlug', auth, getMarketIntelArticle);

module.exports = router;
