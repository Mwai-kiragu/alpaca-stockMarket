const express = require('express');
const {
  getAssets,
  getAsset,
  searchAssets,
  getTradableAssets,
  getPopularAssets,
  getAssetsByExchange
} = require('../controllers/assetController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getAssets);
router.get('/search', auth, searchAssets);
router.get('/tradable', auth, getTradableAssets);
router.get('/popular', auth, getPopularAssets);
router.get('/exchange/:exchange', auth, getAssetsByExchange);
router.get('/:symbol', auth, getAsset);

module.exports = router;