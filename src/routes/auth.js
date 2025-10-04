const express = require('express');
const {
  register,
  login,
  requestVerification,
  verifyCode,
  getAlpacaTerms,
  acceptTermsAndPrivacy,
  getMe,
  checkKYCStatus,
  // Rivenapp pattern endpoints
  requestPasswordReset,
  resetPassword,
  getCurrentUser,
  // Account management
  deleteAccount,
  recoverAccount
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

// Rivenapp pattern endpoints (matching C# API structure)
router.post('/request-password-reset', requestPasswordReset);
router.post('/reset-password', resetPassword);
router.get('/current-user', auth, getCurrentUser);

// Account management
router.delete('/delete-account', auth, deleteAccount);
router.post('/recover-account', recoverAccount);

module.exports = router;