const express = require('express');
const { handleWebhook } = require('../../controllers/mystocks/msWebhookController');

const router = express.Router();

// No auth — MyStocks calls this directly. Signature verified inside the controller.
router.post('/webhooks', handleWebhook);

module.exports = router;
