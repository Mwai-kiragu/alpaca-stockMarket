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
  manageWatchlist,
  createWatchlist,
  getWatchlist,
  updateWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
  deleteWatchlist,
  getTopMovers,
  getUpcomingEvents,
  getStockChart,
  getCompanyInfo
} = require('../controllers/stockController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Stock data endpoints
router.get('/quote/:symbol', auth, getQuote);
router.get('/trade/:symbol', auth, getLatestTrade);
router.get('/bars/:symbol', auth, getBars);
router.get('/chart/:symbol', auth, getStockChart);
router.post('/quotes/multiple', auth, getMultipleQuotes);
router.get('/market/status', auth, getMarketStatus);
router.get('/news', auth, getNews);
router.get('/news/:newsId', auth, getNewsById);
router.get('/market/calendar', auth, getMarketCalendar);
router.get('/fundamentals/:symbol', auth, getStockFundamentals);
router.get('/company/:symbol', auth, getCompanyInfo);

// Market movers & events
router.get('/movers', auth, getTopMovers);
router.get('/events', auth, getUpcomingEvents);

// Watchlists
router.get('/watchlists', auth, getAllWatchlists);
router.post('/watchlists', auth, manageWatchlist); // Unified endpoint (CREATE, UPDATE, ADD, REMOVE, DELETE)
router.get('/watchlist', auth, getWatchlist); // Get user's single watchlist (no ID needed)
router.get('/watchlist/:watchlistId', auth, getWatchlist);
router.put('/watchlist', auth, updateWatchlist); // Update user's single watchlist (no ID needed)
router.put('/watchlist/:watchlistId', auth, updateWatchlist);
router.delete('/watchlist', auth, deleteWatchlist); // Delete user's single watchlist (no ID needed)
router.delete('/watchlist/:watchlistId', auth, deleteWatchlist);
router.post('/watchlist/symbols', auth, addSymbolToWatchlist); // Add to user's single watchlist (no ID needed)
router.post('/watchlist/:watchlistId/symbols', auth, addSymbolToWatchlist);
router.delete('/watchlist/symbols/:symbol', auth, removeSymbolFromWatchlist); // Remove from user's single watchlist (no ID needed)
router.delete('/watchlist/:watchlistId/symbols/:symbol', auth, removeSymbolFromWatchlist);

module.exports = router;