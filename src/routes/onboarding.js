const express = require('express');
const { body } = require('express-validator');
const onboardingController = require('../controllers/onboardingController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Validation rules
const personalDetailsValidation = [
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Date of birth must be a valid date')
    .custom((value) => {
      const date = new Date(value);
      const now = new Date();
      const age = now.getFullYear() - date.getFullYear();
      if (age < 18) {
        throw new Error('Must be at least 18 years old');
      }
      return true;
    }),
  body('gender')
    .isIn(['Male', 'Female', 'Other'])
    .withMessage('Gender must be Male, Female, or Other'),
  body('address.street')
    .notEmpty()
    .withMessage('Street address is required'),
  body('address.city')
    .notEmpty()
    .withMessage('City is required'),
  body('address.state')
    .notEmpty()
    .withMessage('State is required'),
  body('address.country')
    .notEmpty()
    .withMessage('Country is required'),
  body('address.zipCode')
    .notEmpty()
    .withMessage('Zip code is required')
];

const employmentDetailsValidation = [
  body('employmentStatus')
    .isIn(['Employed', 'Self-Employed', 'Unemployed', 'Retired', 'Student'])
    .withMessage('Employment status must be one of: Employed, Self-Employed, Unemployed, Retired, Student'),
  body('monthlyIncome')
    .isFloat({ min: 0 })
    .withMessage('Monthly income must be a positive number'),
  body('yearsAtCurrentJob')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Years at current job must be a positive integer')
];

const kycValidation = [
  body('idType')
    .isIn(['passport', 'nationalId', 'drivingLicense'])
    .withMessage('ID type must be passport, nationalId, or drivingLicense'),
  body('idNumber')
    .notEmpty()
    .withMessage('ID number is required')
    .isLength({ min: 5, max: 50 })
    .withMessage('ID number must be between 5 and 50 characters'),
  body('idExpiryDate')
    .isISO8601()
    .withMessage('ID expiry date must be a valid date')
    .custom((value) => {
      const expiryDate = new Date(value);
      const now = new Date();
      if (expiryDate <= now) {
        throw new Error('ID expiry date must be in the future');
      }
      return true;
    }),
  body('nationality')
    .notEmpty()
    .withMessage('Nationality is required'),
  body('placeOfBirth')
    .notEmpty()
    .withMessage('Place of birth is required'),
  body('purposeOfAccount')
    .isIn(['Personal Banking', 'Business', 'Investment'])
    .withMessage('Purpose of account must be Personal Banking, Business, or Investment'),
  body('sourceOfFunds')
    .isIn(['Salary', 'Business Income', 'Investment', 'Inheritance', 'Other'])
    .withMessage('Source of funds must be one of the specified options'),
  body('expectedTransactionVolume')
    .isIn(['Low', 'Medium', 'High'])
    .withMessage('Expected transaction volume must be Low, Medium, or High')
];

const trustedContactValidation = [
  body('fullName')
    .notEmpty()
    .withMessage('Full name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  body('relationship')
    .isIn(['Parent', 'Sibling', 'Spouse', 'Friend', 'Other'])
    .withMessage('Relationship must be one of: Parent, Sibling, Spouse, Friend, Other'),
  body('email')
    .isEmail()
    .withMessage('Email format is invalid'),
  body('phoneNumber')
    .matches(/^\+[1-9]\d{1,14}$/)
    .withMessage('Phone number format is invalid'),
  body('address.street')
    .notEmpty()
    .withMessage('Street address is required'),
  body('address.city')
    .notEmpty()
    .withMessage('City is required'),
  body('address.state')
    .notEmpty()
    .withMessage('State is required'),
  body('address.country')
    .notEmpty()
    .withMessage('Country is required'),
  body('address.zipCode')
    .notEmpty()
    .withMessage('Zip code is required')
];

const agreementsValidation = [
  body('termsAndConditions')
    .equals('true')
    .withMessage('Terms and conditions must be accepted')
];

// Routes (matching Rivenapp pattern exactly)

// Get current user with personal details (matching Rivenapp pattern)
router.get('/current-user/personal-details', auth, onboardingController.getCurrentUserPersonalDetails);

// Submit onboarding steps (matching Rivenapp pattern)
router.post('/personal-details', auth, personalDetailsValidation, onboardingController.submitPersonalDetails);
router.post('/employment-info', auth, employmentDetailsValidation, onboardingController.submitEmploymentInfo);
router.post('/kyc-info', auth, kycValidation, onboardingController.submitKycInfo);
router.post('/trusted-contact', auth, trustedContactValidation, onboardingController.submitTrustedContact);

// Individual document upload endpoints (matching Rivenapp pattern)
router.post('/upload-id-front', auth, onboardingController.uploadIdFrontMiddleware, onboardingController.uploadIdFront);
router.post('/upload-id-back', auth, onboardingController.uploadIdBackMiddleware, onboardingController.uploadIdBack);
router.post('/upload-proof-of-address', auth, onboardingController.uploadProofOfAddressMiddleware, onboardingController.uploadProofOfAddress);

// Agreements (matching Rivenapp pattern)
router.post('/agreements', auth, agreementsValidation, onboardingController.acceptAgreements);

// Status and progress endpoints (matching Rivenapp pattern)
router.get('/application-status', auth, onboardingController.getApplicationStatus);
router.get('/detailed-status', auth, onboardingController.getDetailedApplicationStatus);
router.get('/progress', auth, onboardingController.getOnboardingProgress);
router.get('/detailed-progress', auth, onboardingController.getDetailedOnboardingProgress);

// Complete onboarding endpoint (original pattern with Alpaca account creation)
router.post('/complete', auth, [
  body('confirmCompletion')
    .equals('true')
    .withMessage('Completion confirmation is required')
], onboardingController.completeOnboarding);

module.exports = router;