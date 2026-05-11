const express = require('express');
const { list, get, create, update, remove } = require('../controllers/postController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/', list);
router.get('/:slug', get);
router.post('/', auth, authorize('admin'), create);
router.put('/:id', auth, authorize('admin'), update);
router.delete('/:id', auth, authorize('admin'), remove);

module.exports = router;
