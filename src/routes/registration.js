const express = require('express');
const multer = require('multer');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const {
  startRegistration,
  saveCitizenship,
  saveEmail,
  savePasswordAndSendVerification,
  verifyEmail,
  savePersonalInfo,
  savePhoneAndSendSMS,
  verifyPhone,
  saveAddress,
  saveQuizAnswers,
  uploadDocuments,
  completeRegistration,
  getCurrentStep,
  registerUser
} = require('../controllers/registrationController');

const router = express.Router();

// Configure multer for document uploads
const upload = multer({
  dest: 'uploads/documents/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and PDF files are allowed'), false);
    }
  }
});

// Start registration - returns registrationId
router.post('/start', startRegistration);

// Step 1: Citizenship
router.post('/citizenship', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('citizenship').notEmpty().isLength({ min: 2, max: 3 }).withMessage('Valid citizenship code required')
], handleValidationErrors, saveCitizenship);

// Step 2: Email
router.post('/email', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('email').isEmail().withMessage('Valid email required').normalizeEmail()
], handleValidationErrors, saveEmail);

// Step 3: Password (automatically sends email verification)
router.post('/password', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('password')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number')
], handleValidationErrors, savePasswordAndSendVerification);

// Step 4: Verify Email
router.post('/verify-email', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('verificationCode').isLength({ min: 6, max: 6 }).isNumeric().withMessage('6-digit code required')
], handleValidationErrors, verifyEmail);

// Step 5: Personal Info (Name, Gender, DOB)
router.post('/personal-info', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('firstName').notEmpty().isLength({ min: 2, max: 50 }).withMessage('First name required (2-50 chars)'),
  body('lastName').notEmpty().isLength({ min: 2, max: 50 }).withMessage('Last name required (2-50 chars)'),
  body('gender').isIn(['male', 'female', 'other']).withMessage('Valid gender required'),
  body('dateOfBirth')
    .isISO8601().withMessage('Valid date required (YYYY-MM-DD)')
    .custom((value) => {
      const age = new Date().getFullYear() - new Date(value).getFullYear();
      if (age < 18 || age > 120) throw new Error('Must be 18-120 years old');
      return true;
    })
], handleValidationErrors, savePersonalInfo);

// Step 6: Phone (automatically sends SMS verification)
router.post('/phone', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('phone').isMobilePhone().withMessage('Valid phone number required')
], handleValidationErrors, savePhoneAndSendSMS);

// Step 7: Verify Phone
router.post('/verify-phone', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('verificationCode').isLength({ min: 6, max: 6 }).isNumeric().withMessage('6-digit code required')
], handleValidationErrors, verifyPhone);

// Step 8: Address
router.post('/address', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('address').notEmpty().isLength({ min: 5, max: 200 }).withMessage('Address required (5-200 chars)'),
  body('city').notEmpty().isLength({ min: 2, max: 50 }).withMessage('City required (2-50 chars)'),
  body('state').notEmpty().isLength({ min: 2, max: 50 }).withMessage('State required (2-50 chars)'),
  body('zipCode').notEmpty().isLength({ min: 3, max: 10 }).withMessage('ZIP code required (3-10 chars)')
], handleValidationErrors, saveAddress);

// Step 9: Quiz Answers
router.post('/quiz', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('answers').isObject().withMessage('Quiz answers object required')
], handleValidationErrors, saveQuizAnswers);

// Step 10: Upload Documents
router.post('/documents', upload.single('document'), [
  body('registrationId').notEmpty().withMessage('Registration ID required')
], handleValidationErrors, uploadDocuments);

// Step 11: Complete Registration
router.post('/complete', [
  body('registrationId').notEmpty().withMessage('Registration ID required'),
  body('termsAccepted').equals('true').withMessage('Terms must be accepted'),
  body('privacyAccepted').equals('true').withMessage('Privacy policy must be accepted')
], handleValidationErrors, completeRegistration);

// Utility: Get current step
router.get('/status/:registrationId', [
  param('registrationId').notEmpty().withMessage('Registration ID required')
], handleValidationErrors, getCurrentStep);

// Alternative: Complete user registration with full payload
router.post('/register', [
  body('firstName')
    .notEmpty().withMessage('First name is required')
    .isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName')
    .notEmpty().withMessage('Last name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('email')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain uppercase, lowercase, number, and special character'),
  body('phone')
    .isMobilePhone().withMessage('Valid phone number is required'),
  body('citizenship')
    .optional()
    .isLength({ min: 2, max: 3 }).withMessage('Valid citizenship code required'),
  body('gender')
    .optional()
    .isIn(['male', 'female', 'other', 'not_specified']).withMessage('Valid gender required'),
  body('dateOfBirth')
    .optional()
    .isISO8601().withMessage('Valid date required (YYYY-MM-DD)')
    .custom((value) => {
      if (value) {
        const age = new Date().getFullYear() - new Date(value).getFullYear();
        if (age < 18 || age > 120) throw new Error('Must be 18-120 years old');
      }
      return true;
    }),
  body('address')
    .optional()
    .isLength({ min: 5, max: 200 }).withMessage('Address must be 5-200 characters'),
  body('city')
    .optional()
    .isLength({ min: 2, max: 50 }).withMessage('City must be 2-50 characters'),
  body('state')
    .optional()
    .isLength({ min: 2, max: 50 }).withMessage('State must be 2-50 characters'),
  body('zipCode')
    .optional()
    .isLength({ min: 3, max: 10 }).withMessage('ZIP code must be 3-10 characters'),
  body('termsAccepted')
    .equals('true').withMessage('Terms and conditions must be accepted'),
  body('privacyAccepted')
    .equals('true').withMessage('Privacy policy must be accepted')
], handleValidationErrors, registerUser);

module.exports = router;