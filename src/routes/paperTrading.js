const express = require('express');
const { auth } = require('../middleware/auth');
const {
  getPaperAccount,
  placePaperTrade,
  getPaperOrders,
  getPaperPositions,
  getPaperPortfolio,
  getPaperAllocation,
  getPaperPerformance
} = require('../controllers/paperTradingController');

const router = express.Router();

router.get('/', auth, getPaperAccount);
router.post('/trade', auth, placePaperTrade);
router.get('/orders', auth, getPaperOrders);
router.get('/positions', auth, getPaperPositions);
router.get('/portfolio', auth, getPaperPortfolio);
router.get('/allocation', auth, getPaperAllocation);
router.get('/performance', auth, getPaperPerformance);

module.exports = router;
