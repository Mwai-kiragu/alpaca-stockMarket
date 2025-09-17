const express = require('express');
const {
  getQuote,
  getLatestTrade,
  getBars,
  getMultipleQuotes,
  getMarketStatus,
  getNews,
  getMarketCalendar,
  getStockFundamentals,
  getWatchlist
} = require('../controllers/stockController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/quote/:symbol', auth, getQuote);
router.get('/trade/:symbol', auth, getLatestTrade);
router.get('/bars/:symbol', auth, getBars);
router.post('/quotes/multiple', auth, getMultipleQuotes);
router.get('/market/status', auth, getMarketStatus);
router.get('/news', auth, getNews);
router.get('/market/calendar', auth, getMarketCalendar);
router.get('/fundamentals/:symbol', auth, getStockFundamentals);
router.get('/watchlist', auth, getWatchlist);

module.exports = router;