const express = require('express');
const {
  getReferralInfo,
  getReferralsList,
  getLeaderboard,
  validateReferralCode,
  getReferralStats
} = require('../controllers/referralController');
const { auth } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(auth);

// Get user's referral info (code, link, position, rewards)
router.get('/', getReferralInfo);

// Get list of users referred by current user
router.get('/list', getReferralsList);

// Get leaderboard
router.get('/leaderboard', getLeaderboard);

// Get referral stats
router.get('/stats', getReferralStats);

// Validate a referral code (public - no auth needed for signup flow)
router.get('/validate/:code', validateReferralCode);

module.exports = router;
