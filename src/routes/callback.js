const express = require('express');
const { mpesaCallback } = require('../controllers/walletController');

const router = express.Router();

/**
 * Payment callback routes
 * These endpoints receive notifications from payment providers
 * No authentication required as these are called by external services
 */

// M-Pesa STK Push callback
router.post('/', mpesaCallback);

// M-Pesa callback with reference (alternative format)
router.post('/:reference', mpesaCallback);

module.exports = router;
