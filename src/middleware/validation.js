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

// Kenya's 47 counties for validation
const KENYA_COUNTIES = [
  'Baringo County', 'Bomet County', 'Bungoma County', 'Busia County', 'Elgeyo-Marakwet County',
  'Embu County', 'Garissa County', 'Homa Bay County', 'Isiolo County', 'Kajiado County',
  'Kakamega County', 'Kericho County', 'Kiambu County', 'Kilifi County', 'Kirinyaga County',
  'Kisii County', 'Kisumu County', 'Kitui County', 'Kwale County', 'Laikipia County',
  'Lamu County', 'Machakos County', 'Makueni County', 'Mandera County', 'Marsabit County',
  'Meru County', 'Migori County', 'Mombasa County', 'Murang\'a County', 'Nairobi County',
  'Nakuru County', 'Nandi County', 'Narok County', 'Nyamira County', 'Nyandarua County',
  'Nyeri County', 'Samburu County', 'Siaya County', 'Taita-Taveta County', 'Tana River County',
  'Tharaka-Nithi County', 'Trans-Nzoia County', 'Turkana County', 'Uasin Gishu County',
  'Vihiga County', 'Wajir County', 'West Pokot County'
];

// Major cities in Kenya for validation
const KENYA_CITIES = [
  'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika', 'Malindi', 'Kitale',
  'Garissa', 'Kakamega', 'Nyeri', 'Meru', 'Embu', 'Machakos', 'Kericho', 'Bomet',
  'Homa Bay', 'Bungoma', 'Narok', 'Voi', 'Kilifi', 'Lamu', 'Isiolo', 'Nanyuki',
  'Chuka', 'Wajir', 'Mandera', 'Marsabit', 'Moyale', 'Lodwar', 'Kapenguria', 'Kisii',
  'Kerugoya', 'Murang\'a', 'Kiambu', 'Limuru', 'Ruiru'
];

// Flexible international address validation
const validateInternationalAddress = (value) => {
  if (!value || typeof value !== 'object') {
    throw new Error('Address must be a valid object');
  }

  const { street, city, state, country, zipCode } = value;

  // Required fields - basic validation only
  if (!street || street.trim().length === 0) {
    throw new Error('Street address is required');
  }

  if (!city || city.trim().length === 0) {
    throw new Error('City is required');
  }

  if (!state || state.trim().length === 0) {
    throw new Error('State/Province/County is required');
  }

  if (!country || country.trim().length === 0) {
    throw new Error('Country is required');
  }

  // Optional: Validate postal code format based on country
  if (zipCode) {
    const countryLower = country.toLowerCase();

    // Only validate postal codes for countries where we know the format
    if (countryLower === 'kenya' && !/^\d{5}$/.test(zipCode)) {
      throw new Error('Kenyan postal code should be 5 digits');
    } else if (countryLower === 'usa' && !/^\d{5}(-\d{4})?$/.test(zipCode)) {
      throw new Error('US zip code should be 5 digits or 5+4 format');
    } else if (countryLower === 'uk' && !/^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i.test(zipCode)) {
      throw new Error('UK postal code format is invalid');
    }
    // For other countries, accept any postal code format
  }

  // Validate that county is in the correct format for Kenya (helpful but not required)
  if (country.toLowerCase() === 'kenya') {
    const isValidCounty = KENYA_COUNTIES.some(county =>
      county.toLowerCase() === state.toLowerCase()
    );

    if (!isValidCounty && !state.toLowerCase().includes('county')) {
      console.log(`Note: ${state} doesn't match known Kenyan counties. Consider using format: "${state} County"`);
    }
  }

  return true;
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

// Personal details validation with international address support
const personalDetailsValidation = [
  body('dateOfBirth')
    .isISO8601()
    .withMessage('Valid date of birth is required (YYYY-MM-DD format)'),
  body('gender')
    .isIn(['Male', 'Female', 'Other', 'male', 'female', 'other'])
    .withMessage('Gender must be Male, Female, or Other'),
  body('address')
    .custom(validateInternationalAddress)
    .withMessage('Valid address is required'),
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

const withdrawalValidation = [
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be at least 1'),
  body('currency')
    .isIn(['KES', 'USD'])
    .withMessage('Currency must be KES or USD'),
  body('method')
    .isIn(['mpesa', 'bank_transfer', 'paypal'])
    .withMessage('Method must be mpesa, bank_transfer, or paypal'),
  body('accountDetails')
    .notEmpty()
    .withMessage('Account details are required')
    .custom((value, { req }) => {
      const method = req.body.method;

      if (method === 'mpesa') {
        if (!value.phoneNumber) {
          throw new Error('Phone number is required for M-Pesa withdrawals');
        }
        if (!/^(\+?254|0)[17]\d{8}$/.test(value.phoneNumber)) {
          throw new Error('Invalid Kenyan phone number format');
        }
      } else if (method === 'bank_transfer') {
        if (!value.accountNumber || !value.bankName || !value.accountName) {
          throw new Error('Account number, bank name, and account name are required for bank transfers');
        }
        if (req.body.currency === 'USD' && !value.swiftCode) {
          throw new Error('SWIFT code is required for USD bank transfers');
        }
      } else if (method === 'paypal') {
        if (!value.email) {
          throw new Error('PayPal email is required');
        }
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(value.email)) {
          throw new Error('Invalid PayPal email format');
        }
      }

      return true;
    }),
  handleValidationErrors
];

module.exports = {
  registerValidation,
  loginValidation,
  orderValidation,
  depositValidation,
  kycValidation,
  supportTicketValidation,
  personalDetailsValidation,
  paginationValidation,
  withdrawalValidation,
  handleValidationErrors,
  KENYA_COUNTIES, // Export for use in other parts of the app
  KENYA_CITIES    // Export for use in other parts of the app
};