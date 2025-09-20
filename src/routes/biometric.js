const express = require('express');
const { body, param } = require('express-validator');
const {
  enrollBiometric,
  requestChallenge,
  verifyBiometric,
  getBiometricDevices,
  disableBiometric,
  updateSecurityPreferences,
  setPin
} = require('../controllers/biometricController');
const { auth } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Enroll biometric authentication
router.post('/enroll',
  auth,
  [
    body('deviceId')
      .notEmpty()
      .withMessage('Device ID is required'),
    body('biometricType')
      .isIn(['fingerprint', 'face', 'voice', 'iris'])
      .withMessage('Invalid biometric type'),
    body('publicKey')
      .notEmpty()
      .withMessage('Public key is required'),
    body('biometricTemplateHash')
      .notEmpty()
      .withMessage('Biometric template hash is required'),
    body('deviceName')
      .optional()
      .isLength({ min: 1, max: 255 })
      .withMessage('Device name must be between 1 and 255 characters'),
    body('deviceModel')
      .optional()
      .isLength({ min: 1, max: 255 })
      .withMessage('Device model must be between 1 and 255 characters'),
    body('osVersion')
      .optional()
      .isLength({ min: 1, max: 100 })
      .withMessage('OS version must be between 1 and 100 characters')
  ],
  handleValidationErrors,
  enrollBiometric
);

// Request biometric challenge
router.post('/challenge',
  auth,
  [
    body('deviceId')
      .notEmpty()
      .withMessage('Device ID is required')
  ],
  handleValidationErrors,
  requestChallenge
);

// Verify biometric authentication
router.post('/verify',
  auth,
  [
    body('deviceId')
      .notEmpty()
      .withMessage('Device ID is required'),
    body('challengeToken')
      .notEmpty()
      .withMessage('Challenge token is required'),
    body('biometricResponse')
      .notEmpty()
      .withMessage('Biometric response is required')
  ],
  handleValidationErrors,
  verifyBiometric
);

// Get user's biometric devices
router.get('/devices',
  auth,
  getBiometricDevices
);

// Disable biometric authentication for a device
router.delete('/devices/:deviceId',
  auth,
  [
    param('deviceId')
      .notEmpty()
      .withMessage('Device ID is required')
  ],
  handleValidationErrors,
  disableBiometric
);

// Update security preferences
router.put('/preferences',
  auth,
  [
    body('requireBiometricForLogin')
      .optional()
      .isBoolean()
      .withMessage('requireBiometricForLogin must be a boolean'),
    body('requireBiometricForTransactions')
      .optional()
      .isBoolean()
      .withMessage('requireBiometricForTransactions must be a boolean'),
    body('biometricTimeoutMinutes')
      .optional()
      .isInt({ min: 1, max: 60 })
      .withMessage('biometricTimeoutMinutes must be between 1 and 60')
  ],
  handleValidationErrors,
  updateSecurityPreferences
);

// Set PIN
router.post('/pin',
  auth,
  [
    body('pin')
      .matches(/^\d{4}$/)
      .withMessage('PIN must be exactly 4 digits')
  ],
  handleValidationErrors,
  setPin
);

module.exports = router;