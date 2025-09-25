const express = require('express');
const {
  register,
  login,
  requestVerification,
  verifyCode,
  getMe
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

// User profile
router.get('/me', auth, getMe);

module.exports = router;