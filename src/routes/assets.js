const express = require('express');
const {
  getAssets,
  getAsset,
  searchAssets,
  getTradableAssets,
  getPopularAssets,
  getAssetsByExchange
} = require('../controllers/assetController');
const { getCompanyLogo } = require('../controllers/logoController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Public logo endpoint (no auth required for image display)
router.get('/logo/:symbol', getCompanyLogo);

router.get('/', auth, getAssets);
router.get('/search', auth, searchAssets);
router.get('/tradable', auth, getTradableAssets);
router.get('/popular', auth, getPopularAssets);
router.get('/exchange/:exchange', auth, getAssetsByExchange);
router.get('/:symbol', auth, getAsset);

module.exports = router;