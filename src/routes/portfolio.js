const express = require('express');
const {
  getPortfolio,
  getPositions,
  getPosition,
  getPerformance,
  closePosition,
  getAssetTrend,
  getPortfolioAllocation
} = require('../controllers/portfolioController');
const { auth } = require('../middleware/auth');
const { checkAccountStatus } = require('../middleware/checkAccountStatus');

const router = express.Router();

// Read-only operations - allow even for closed accounts so users can view their data
router.get('/', auth, getPortfolio);
router.get('/positions', auth, getPositions);
router.get('/positions/:symbol', auth, getPosition);
router.get('/performance', auth, getPerformance);
router.get('/asset-trend', auth, getAssetTrend);
router.get('/allocation', auth, getPortfolioAllocation);

// Trading operations - require active account
router.post('/positions/:symbol/close', auth, checkAccountStatus, closePosition);

module.exports = router;