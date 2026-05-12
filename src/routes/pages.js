const express = require('express');
const { get, upsert } = require('../controllers/pageController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/:slug', get);
router.put('/:slug', auth, authorize('admin'), upsert);

module.exports = router;
