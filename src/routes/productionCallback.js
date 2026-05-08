const express = require('express');
const { handleKCBMpesaCallback } = require('../controllers/callbackController');
const router = express.Router();

// Production callback endpoint - same functionality as development callback
router.post('/', handleKCBMpesaCallback);

module.exports = router;
