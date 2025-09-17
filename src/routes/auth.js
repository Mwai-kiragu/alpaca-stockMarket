const express = require('express');
const {
  register,
  login,
  getMe,
  updateProfile,
  submitKYC,
  changePassword,
  forgotPassword,
  verifyEmail,
  resendVerificationEmail
} = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const {
  registerValidation,
  loginValidation,
  kycValidation
} = require('../middleware/validation');

const router = express.Router();

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.get('/me', auth, getMe);
router.put('/profile', auth, updateProfile);
router.post('/kyc', auth, kycValidation, submitKYC);
router.put('/change-password', auth, changePassword);
router.post('/forgot-password', forgotPassword);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', auth, resendVerificationEmail);

module.exports = router;