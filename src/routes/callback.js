const express = require('express');
const { mpesaCallback } = require('../controllers/walletController');
const { handleKCBMpesaCallback } = require('../controllers/callbackController');
const router = express.Router();

router.post('/', handleKCBMpesaCallback);
router.post('/legacy/:reference', mpesaCallback);

module.exports = router;
