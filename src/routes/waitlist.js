const express = require('express');
const { join, list, remove } = require('../controllers/waitlistController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.post('/', join);
router.get('/', auth, authorize('admin'), list);
router.delete('/:id', auth, authorize('admin'), remove);

module.exports = router;
