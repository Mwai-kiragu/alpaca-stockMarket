const express = require('express');

// Import from the notification controller
const {
  addDeviceToken,
  removeDeviceToken,
  getPreferences,
  updatePreferences,
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  sendTestNotification,
  triggerRegistrationNotification
} = require('../controllers/notificationController');

const { auth } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// ======================
// NOTIFICATION INBOX
// ======================
router.get('/', auth, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('unreadOnly')
    .optional()
    .isBoolean()
    .withMessage('unreadOnly must be a boolean')
], handleValidationErrors, getNotifications);

router.put('/:notificationId/read', auth, [
  param('notificationId')
    .isUUID()
    .withMessage('notificationId must be a valid UUID')
], handleValidationErrors, markAsRead);

router.put('/mark-all-read', auth, markAllAsRead);

router.get('/unread-count', auth, getUnreadCount);

// ======================
// DEVICE MANAGEMENT
// ======================
router.post('/device-token', auth, [
  body('deviceToken')
    .notEmpty()
    .withMessage('Device token is required'),
  body('platform')
    .optional()
    .isIn(['ios', 'android', 'web'])
    .withMessage('Platform must be ios, android, or web'),
  body('deviceInfo')
    .optional()
    .isObject()
    .withMessage('Device info must be an object')
], handleValidationErrors, addDeviceToken);

router.delete('/device-token', auth, [
  body('deviceToken')
    .notEmpty()
    .withMessage('Device token is required')
], handleValidationErrors, removeDeviceToken);

// ======================
// NOTIFICATION PREFERENCES
// ======================
router.get('/preferences', auth, getPreferences);

router.put('/preferences', auth, [
  body('push_enabled')
    .optional()
    .isBoolean()
    .withMessage('push_enabled must be a boolean'),
  body('email_enabled')
    .optional()
    .isBoolean()
    .withMessage('email_enabled must be a boolean'),
  body('sms_enabled')
    .optional()
    .isBoolean()
    .withMessage('sms_enabled must be a boolean'),
  body('security_alerts')
    .optional()
    .isBoolean()
    .withMessage('security_alerts must be a boolean'),
  body('transaction_alerts')
    .optional()
    .isBoolean()
    .withMessage('transaction_alerts must be a boolean'),
  body('account_updates')
    .optional()
    .isBoolean()
    .withMessage('account_updates must be a boolean'),
  body('kyc_updates')
    .optional()
    .isBoolean()
    .withMessage('kyc_updates must be a boolean'),
  body('price_alerts')
    .optional()
    .isBoolean()
    .withMessage('price_alerts must be a boolean'),
  body('portfolio_updates')
    .optional()
    .isBoolean()
    .withMessage('portfolio_updates must be a boolean'),
  body('news_updates')
    .optional()
    .isBoolean()
    .withMessage('news_updates must be a boolean'),
  body('marketing_enabled')
    .optional()
    .isBoolean()
    .withMessage('marketing_enabled must be a boolean')
], handleValidationErrors, updatePreferences);

// ======================
// TESTING & MANUAL TRIGGERS
// ======================
router.post('/test', auth, [
  body('type')
    .optional()
    .isIn(['security_alerts', 'account_updates', 'kyc_updates', 'transaction_alerts', 'price_alerts'])
    .withMessage('type must be a valid notification type'),
  body('title')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('title must be between 1 and 100 characters'),
  body('body')
    .optional()
    .isLength({ min: 1, max: 500 })
    .withMessage('body must be between 1 and 500 characters')
], handleValidationErrors, sendTestNotification);

router.post('/trigger/:type', auth, [
  param('type')
    .isIn(['welcome', 'email_verification', 'phone_verification', 'kyc_approved', 'account_activated', 'biometric_setup'])
    .withMessage('type must be a valid registration notification type')
], handleValidationErrors, triggerRegistrationNotification);

module.exports = router;