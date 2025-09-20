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
  verifyEmailCode,
  completeProfile,
  verifyPhoneCode,
  completeAddress,
  submitKYCDocuments,
  resendVerificationEmail,
  resendPhoneCode
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

// Step-by-step registration endpoints
router.post('/verify-email-code', verifyEmailCode);
router.post('/complete-profile', auth, completeProfile);
router.post('/verify-phone-code', auth, verifyPhoneCode);
router.post('/complete-address', auth, completeAddress);
router.post('/submit-kyc-documents', auth, submitKYCDocuments);

// Legacy KYC endpoint
router.post('/kyc', auth, kycValidation, submitKYC);

// Password and verification endpoints
router.put('/change-password', auth, changePassword);
router.post('/forgot-password', forgotPassword);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', auth, resendVerificationEmail);
router.post('/resend-phone-code', auth, resendPhoneCode);

module.exports = router;