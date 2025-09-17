const express = require('express');
const {
  createOrder,
  getOrders,
  getOrder,
  cancelOrder,
  syncOrdersWithAlpaca
} = require('../controllers/orderController');
const { auth, requireKYC } = require('../middleware/auth');
const { orderValidation, paginationValidation } = require('../middleware/validation');

const router = express.Router();

router.post('/', auth, requireKYC, orderValidation, createOrder);
router.get('/', auth, paginationValidation, getOrders);
router.get('/:orderId', auth, getOrder);
router.delete('/:orderId', auth, cancelOrder);
router.post('/sync', auth, syncOrdersWithAlpaca);

module.exports = router;