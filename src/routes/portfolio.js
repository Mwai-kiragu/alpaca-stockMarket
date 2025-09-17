const express = require('express');
const {
  getPortfolio,
  getPositions,
  getPosition,
  getPerformance,
  closePosition
} = require('../controllers/portfolioController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getPortfolio);
router.get('/positions', auth, getPositions);
router.get('/positions/:symbol', auth, getPosition);
router.get('/performance', auth, getPerformance);
router.post('/positions/:symbol/close', auth, closePosition);

module.exports = router;