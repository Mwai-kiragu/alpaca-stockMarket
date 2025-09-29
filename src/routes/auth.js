const express = require('express');
const {
  register,
  login,
  requestVerification,
  verifyCode,
  getAlpacaTerms,
  acceptTermsAndPrivacy,
  getMe,
  checkKYCStatus
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const {
  registerValidation,
  loginValidation
} = require('../middleware/validation');

const router = express.Router();

// Authentication endpoints
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);

// Verification endpoints
router.post('/request-verification', auth, requestVerification);
// TEMPORARILY REMOVED AUTH: Will add back when email service is ready
router.post('/verify', verifyCode);

// Get Alpaca terms and privacy policy
router.get('/alpaca-terms', getAlpacaTerms);

// Accept terms and privacy policy
router.post('/accept-terms', auth, acceptTermsAndPrivacy);

// User profile
router.get('/me', auth, getMe);

// Check KYC status from Alpaca
router.get('/kyc-status', auth, checkKYCStatus);

module.exports = router;