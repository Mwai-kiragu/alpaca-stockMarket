const express = require('express');
const {
  searchStocks,
  searchByCategory,
  getTrendingStocks,
  getMarketMovers
} = require('../controllers/searchController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, searchStocks);
router.get('/category', auth, searchByCategory);
router.get('/trending', auth, getTrendingStocks);
router.get('/movers', auth, getMarketMovers);

module.exports = router;