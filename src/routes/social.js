const express = require('express');
const { list, listAll, upsert } = require('../controllers/socialController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', list);
router.get('/all', auth, authorize('admin'), listAll);
router.put('/:platform', auth, authorize('admin'), upsert);

module.exports = router;
