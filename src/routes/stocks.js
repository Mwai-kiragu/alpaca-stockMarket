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
  // Watchlist management
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
router.get('/market/calendar', auth, getMarketCalendar);
router.get('/fundamentals/:symbol', auth, getStockFundamentals);

// ============================================================
// WATCHLIST MANAGEMENT ROUTES
// ============================================================

// Get all watchlists
router.get('/watchlists', auth, getAllWatchlists);

// Create a new watchlist
router.post('/watchlists', auth, createWatchlist);

// Get a specific watchlist with market data
router.get('/watchlist/:watchlistId', auth, getWatchlist);

// Update a watchlist (name and symbols)
router.put('/watchlist/:watchlistId', auth, updateWatchlist);

// Delete a watchlist
router.delete('/watchlist/:watchlistId', auth, deleteWatchlist);

// Add a symbol to a watchlist
router.post('/watchlist/:watchlistId/symbols', auth, addSymbolToWatchlist);

// Remove a symbol from a watchlist
router.delete('/watchlist/:watchlistId/symbols/:symbol', auth, removeSymbolFromWatchlist);

module.exports = router;