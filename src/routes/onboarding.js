const express = require('express');
const { body } = require('express-validator');
const onboardingController = require('../controllers/onboardingController');
const { auth } = require('../middleware/auth');

const router = express.Router();

const personalDetailsValidation = [
  body('city').trim().notEmpty().withMessage('City is required'),
  body('postalCode').trim().notEmpty().withMessage('Postal code is required'),
  body('streetAddress').trim().notEmpty().withMessage('Street address is required'),
  body('apartment').optional().trim()
];

const employmentDetailsValidation = [
  body('employmentStatus')
    .isIn(['Employed', 'Self-Employed', 'Unemployed', 'Retired', 'Student'])
    .withMessage('Employment status must be one of: Employed, Self-Employed, Unemployed, Retired, Student'),
  body('employerName')
    .optional()
    .trim(),
  body('jobTitle')
    .optional()
    .trim(),
  body('country')
    .optional()
    .trim()
];

const kycValidation = [
  body('idType')
    .isIn(['passport', 'nationalId', 'drivingLicense'])
    .withMessage('ID type must be passport, nationalId, or drivingLicense'),
  body('idNumber')
    .notEmpty()
    .withMessage('ID number is required'),
  body('idExpiryDate')
    .optional()
    .isISO8601()
    .withMessage('ID expiry date must be a valid date'),
  body('nationality')
    .notEmpty()
    .withMessage('Nationality is required')
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

const sourceOfWealthValidation = [
  body('sourceOfWealth')
    .isIn(['salary', 'family', 'inheritance', 'investments', 'student loans'])
    .withMessage('Source of wealth must be one of: salary, family, inheritance, investments, student loans'),
  body('selectedOption')
    .trim()
    .notEmpty()
    .withMessage('Selected option is required')
];

const investingSavingsValidation = [
  body('investingWithSavings')
    .isBoolean()
    .withMessage('Investing with savings must be true or false'),
  body('selectedOption')
    .trim()
    .notEmpty()
    .withMessage('Selected option is required')
];

const disclosuresValidation = [
  body('affiliatedWithBrokerDealer')
    .optional()
    .isBoolean()
    .withMessage('affiliatedWithBrokerDealer must be a boolean'),
  body('publiclyTradedCompany')
    .optional()
    .isBoolean()
    .withMessage('publiclyTradedCompany must be a boolean'),
  body('politicallyExposedPerson')
    .optional()
    .isBoolean()
    .withMessage('politicallyExposedPerson must be a boolean'),
  body('familyOfPoliticalFigure')
    .optional()
    .isBoolean()
    .withMessage('familyOfPoliticalFigure must be a boolean'),
  body('noneApply')
    .optional()
    .isBoolean()
    .withMessage('noneApply must be a boolean'),
  body('selectedDisclosure')
    .trim()
    .notEmpty()
    .withMessage('Selected disclosure is required')
];

const investmentExperienceValidation = [
  body('investmentExperience')
    .isIn(['none', 'beginner', 'intermediate', 'expert'])
    .withMessage('Investment experience must be one of: none, beginner, intermediate, expert'),
  body('selectedOption')
    .trim()
    .notEmpty()
    .withMessage('Selected option is required')
];

// Routes (matching Rivenapp pattern exactly)

// Get current user with personal details (matching Rivenapp pattern)
router.get('/current-user/personal-details', auth, onboardingController.getCurrentUserPersonalDetails);

// Submit onboarding steps (matching Rivenapp pattern)
router.post('/personal-details', auth, personalDetailsValidation, onboardingController.submitPersonalDetails);
router.post('/employment-info', auth, employmentDetailsValidation, onboardingController.submitEmploymentInfo);
router.post('/source-of-wealth', auth, sourceOfWealthValidation, onboardingController.submitSourceOfWealth);
router.post('/investing-savings', auth, investingSavingsValidation, onboardingController.submitInvestingSavings);
router.post('/disclosures', auth, disclosuresValidation, onboardingController.submitDisclosures);
router.post('/tax-info', auth, onboardingController.uploadTaxDocumentMiddleware, onboardingController.uploadTaxDocument);
router.post('/kyc-info', auth, kycValidation, onboardingController.submitKycInfo);
router.post('/investment-experience', auth, investmentExperienceValidation, onboardingController.submitInvestmentExperience);
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

// User settings endpoints
router.get('/settings', auth, onboardingController.getUserSettings);
router.put('/settings', auth, onboardingController.updateUserSettings);
router.patch('/settings', auth, onboardingController.updateUserSettings);

// Document retrieval endpoint
router.get('/documents', auth, onboardingController.getDocument);

// SANDBOX/TEST ENDPOINTS - Only available in development/test environments
router.post('/sandbox/approve-kyc/:userId?', auth, onboardingController.sandboxApproveKyc);
router.post('/sandbox/approve-all-kyc', auth, onboardingController.sandboxApproveAllKyc);

module.exports = router;