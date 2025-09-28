const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: errors.array()
    });
  }
  next();
};

const registerValidation = [
  body('fullName')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Full name must be at least 2 characters'),
  body('email')
    .custom((value) => {
      // Enhanced email validation to support Gmail aliases and testing
      if (!value || value.trim().length === 0) {
        throw new Error('Email is required');
      }

      // Gmail alias pattern: allows + symbol before @gmail.com
      // Examples: user+tag@gmail.com, test+123@gmail.com
      const gmailAliasRegex = /^[a-zA-Z0-9._%+-]+\+[a-zA-Z0-9._%-]*@gmail\.com$/;

      // Standard email pattern (supports most valid emails)
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

      // Test email pattern for development
      const testEmailRegex = /^[a-zA-Z0-9._%+-]+@test\.com$/;

      if (gmailAliasRegex.test(value) || emailRegex.test(value) || testEmailRegex.test(value)) {
        return true;
      }

      throw new Error('Please enter a valid email address');
    })
    .withMessage('Valid email is required'),
  body('phoneNumber')
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .custom((value) => {
      // More lenient password validation for testing
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'testing') {
        // In development, just require minimum length
        return value && value.length >= 6;
      }

      // In production, enforce strong password
      const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
      if (!strongPasswordRegex.test(value)) {
        throw new Error('Password must contain at least one uppercase letter, one lowercase letter, and one number');
      }

      return true;
    }),
  handleValidationErrors
];

const loginValidation = [
  body('email')
    .custom((value) => {
      // Enhanced email validation to support Gmail aliases and testing
      if (!value || value.trim().length === 0) {
        throw new Error('Email is required');
      }

      // Gmail alias pattern: allows + symbol before @gmail.com
      // Examples: user+tag@gmail.com, test+123@gmail.com
      const gmailAliasRegex = /^[a-zA-Z0-9._%+-]+\+[a-zA-Z0-9._%-]*@gmail\.com$/;

      // Standard email pattern (supports most valid emails)
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

      // Test email pattern for development
      const testEmailRegex = /^[a-zA-Z0-9._%+-]+@test\.com$/;

      if (gmailAliasRegex.test(value) || emailRegex.test(value) || testEmailRegex.test(value)) {
        return true;
      }

      throw new Error('Please enter a valid email address');
    })
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

const orderValidation = [
  body('symbol')
    .notEmpty()
    .toUpperCase()
    .withMessage('Stock symbol is required'),
  body('side')
    .isIn(['buy', 'sell'])
    .withMessage('Side must be buy or sell'),
  body('orderType')
    .isIn(['market', 'limit', 'stop', 'stop_limit'])
    .withMessage('Invalid order type'),
  body('quantity')
    .isFloat({ min: 0.01 })
    .withMessage('Quantity must be greater than 0'),
  body('currency')
    .isIn(['KES', 'USD'])
    .withMessage('Currency must be KES or USD'),
  handleValidationErrors
];

const depositValidation = [
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be at least 1'),
  body('currency')
    .isIn(['KES'])
    .withMessage('Only KES deposits supported'),
  body('phone')
    .isMobilePhone('any')
    .withMessage('Valid phone number is required'),
  handleValidationErrors
];

const kycValidation = [
  body('idNumber')
    .notEmpty()
    .withMessage('ID number is required'),
  body('idType')
    .isIn(['national_id', 'passport'])
    .withMessage('ID type must be national_id or passport'),
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Valid date of birth is required'),
  body('address')
    .notEmpty()
    .withMessage('Address is required'),
  body('occupation')
    .notEmpty()
    .withMessage('Occupation is required'),
  handleValidationErrors
];

const supportTicketValidation = [
  body('category')
    .isIn([
      'account_issues',
      'trading_issues',
      'deposit_withdrawal',
      'technical_support',
      'kyc_verification',
      'general_inquiry',
      'complaint',
      'feature_request',
      'bug_report'
    ])
    .withMessage('Invalid category'),
  body('subject')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Subject must be between 5 and 200 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Description must be between 10 and 2000 characters'),
  handleValidationErrors
];

const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

module.exports = {
  registerValidation,
  loginValidation,
  orderValidation,
  depositValidation,
  kycValidation,
  supportTicketValidation,
  paginationValidation,
  handleValidationErrors
};