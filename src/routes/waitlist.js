const express = require('express');
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const {
  joinWaitlist,
  verifyEmail,
  resendVerification,
  getPosition,
  getStats,
  getLeaderboard,
  checkReferralCode,
  inviteToBeta
} = require('../controllers/waitlistController');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Rate limiters
const joinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
    statusCode: 429
  }
});

const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: {
    success: false,
    message: 'Too many requests. Please slow down.',
    statusCode: 429
  }
});

// ============ PUBLIC ENDPOINTS ============

// Join waitlist
router.post('/join',
  joinLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail({ gmail_remove_subaddress: false }),
    body('phone').optional(),
    body('ref').optional().isString()
  ],
  joinWaitlist
);

// Verify email (optional)
router.post('/verify-email',
  generalLimiter,
  [body('token').notEmpty().withMessage('Token is required')],
  verifyEmail
);

// Resend verification
router.post('/resend-verification',
  generalLimiter,
  [body('email').isEmail().normalizeEmail({ gmail_remove_subaddress: false })],
  resendVerification
);

// Get position
router.get('/position/:userId?',
  generalLimiter,
  [
    param('userId').optional().isUUID(),
    query('email').optional().isEmail()
  ],
  getPosition
);

// Get stats
router.get('/stats', generalLimiter, getStats);

// Get leaderboard
router.get('/leaderboard',
  generalLimiter,
  [query('limit').optional().isInt({ min: 1, max: 50 })],
  getLeaderboard
);

// Check referral code
router.get('/check-referral/:code',
  generalLimiter,
  [param('code').notEmpty()],
  checkReferralCode
);

// ============ ADMIN ENDPOINTS ============

// Invite to beta (admin only)
router.post('/admin/invite-beta',
  auth,
  adminAuth,
  [body('count').optional().isInt({ min: 1, max: 1000 })],
  inviteToBeta
);

module.exports = router;
