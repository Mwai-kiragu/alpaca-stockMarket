const express = require('express');
const {
  getQuote,
  getLatestTrade,
  getBars,
  getMultipleQuotes,
  getMarketStatus,
  getNews,
  getNewsById,
  getMarketCalendar,
  getStockFundamentals,
  getAllWatchlists,
  createWatchlist,
  getWatchlist,
  updateWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  deleteWatchlist
} = require('../controllers/stockController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Stock data endpoints
router.get('/quote/:symbol', auth, getQuote);
router.get('/trade/:symbol', auth, getLatestTrade);
router.get('/bars/:symbol', auth, getBars);
router.post('/quotes/multiple', auth, getMultipleQuotes);
router.get('/market/status', auth, getMarketStatus);
router.get('/news', auth, getNews);
router.get('/news/:newsId', auth, getNewsById);
router.get('/market/calendar', auth, getMarketCalendar);
router.get('/fundamentals/:symbol', auth, getStockFundamentals);
router.get('/watchlists', auth, getAllWatchlists);
router.post('/watchlists', auth, createWatchlist);
router.get('/watchlist/:watchlistId', auth, getWatchlist);
router.put('/watchlist/:watchlistId', auth, updateWatchlist);
router.delete('/watchlist/:watchlistId', auth, deleteWatchlist);
router.post('/watchlist/:watchlistId/symbols', auth, addSymbolToWatchlist);
router.delete('/watchlist/:watchlistId/symbols/:symbol', auth, removeSymbolFromWatchlist);

module.exports = router;