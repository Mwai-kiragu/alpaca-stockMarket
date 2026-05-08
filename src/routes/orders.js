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
const { checkAccountStatus } = require('../middleware/checkAccountStatus');

const router = express.Router();

// Trading operations require account status check
router.post('/', auth, requireKYC, checkAccountStatus, orderValidation, createOrder);
router.get('/', auth, paginationValidation, getOrders);
router.get('/:orderId', auth, getOrder);
router.delete('/:orderId', auth, checkAccountStatus, cancelOrder);
router.post('/sync', auth, syncOrdersWithAlpaca);

module.exports = router;