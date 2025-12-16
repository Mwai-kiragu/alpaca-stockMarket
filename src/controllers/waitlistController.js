const WaitlistUser = require('../models/WaitlistUser');
const Referral = require('../models/Referral');
const logger = require('../utils/logger');
const emailService = require('../services/emailService');
const crypto = require('crypto');
const { Op } = require('sequelize');

// Standardized API Response Helper
const ApiResponse = {
  Success: (data, message = 'Success') => ({
    success: true,
    message,
    data
  }),
  Error: (message, statusCode = 400) => ({
    success: false,
    message,
    statusCode
  })
};

/**
 * Join Waitlist - Simplified like Exness
 * - Instant signup (no email verification required)
 * - Get referral code immediately
 * - Track referrals automatically
 */
const joinWaitlist = async (req, res) => {
  try {
    const { email, phone, ref } = req.body;

    if (!email) {
      return res.status(400).json(ApiResponse.Error('Email is required'));
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already exists
    const existingUser = await WaitlistUser.findOne({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      const position = await getPosition(existingUser);
      const totalUsers = await WaitlistUser.count();
      const peopleAhead = position - 1;

      return res.status(200).json(ApiResponse.Success({
        id: existingUser.id,
        email: existingUser.email,
        referralCode: existingUser.referral_code,
        referralLink: `https://www.rivenapp.com/?ref=${existingUser.referral_code}`,
        position,
        peopleAhead,
        totalUsers,
        referralsCount: existingUser.referrals_count,
        isExisting: true
      }, 'You are already on the waitlist!'));
    }

    // Get IP for basic fraud prevention
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0] || 'unknown';

    // Find referrer if code provided
    let referrerId = null;
    let referrerInfo = null;

    if (ref) {
      const referrer = await WaitlistUser.findOne({
        where: { referral_code: ref }
      });

      if (referrer) {
        referrerId = referrer.id;
        referrerInfo = {
          email: maskEmail(referrer.email),
          referralCode: referrer.referral_code
        };
      }
    }

    // Create user - auto-generates referral code via model hook
    const newUser = await WaitlistUser.create({
      email: normalizedEmail,
      phone: phone || null,
      referred_by: referrerId,
      ip_address: ipAddress,
      user_agent: req.headers['user-agent'],
      verified: true, // Auto-verify for simplicity
      status: 'verified'
    });

    // Track referral if applicable
    if (referrerId) {
      await Referral.create({
        referrer_user_id: referrerId,
        referred_user_id: newUser.id,
        referred_email: normalizedEmail,
        ip_address: ipAddress,
        is_valid: true,
        is_verified: true,
        status: 'verified'
      });
    }

    const position = await getPosition(newUser);
    const totalUsers = await WaitlistUser.count();
    const peopleAhead = position - 1;
    const referralLink = `https://www.rivenapp.com/?ref=${newUser.referral_code}`;

    logger.info(`Waitlist signup: ${normalizedEmail}, Position: ${position}, People ahead: ${peopleAhead}, Referrer: ${referrerInfo?.email || 'none'}`);

    // Send welcome email asynchronously (don't block the response)
    emailService.sendWaitlistWelcomeEmail({
      email: newUser.email,
      referralCode: newUser.referral_code,
      referralLink,
      peopleAhead,
      position,
      totalUsers
    }).then(result => {
      if (result.success) {
        logger.info(`Waitlist welcome email sent to ${normalizedEmail}`);
      } else {
        logger.warn(`Failed to send waitlist email to ${normalizedEmail}: ${result.error || result.message}`);
      }
    }).catch(err => {
      logger.error(`Error sending waitlist email to ${normalizedEmail}:`, err);
    });

    return res.status(201).json(ApiResponse.Success({
      id: newUser.id,
      email: newUser.email,
      referralCode: newUser.referral_code,
      referralLink,
      position,
      peopleAhead,
      totalUsers,
      referralsCount: 0,
      referredBy: referrerInfo
    }, 'Successfully joined the waitlist!'));

  } catch (error) {
    logger.error('Join waitlist error:', error);

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json(ApiResponse.Error('This email is already registered'));
    }

    return res.status(500).json(ApiResponse.Error('Something went wrong. Please try again.'));
  }
};

/**
 * Get User Position - Check your rank
 */
const getPositionEndpoint = async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.query;

    let user;
    if (userId) {
      user = await WaitlistUser.findByPk(userId);
    } else if (email) {
      user = await WaitlistUser.findOne({
        where: { email: email.toLowerCase().trim() }
      });
    }

    if (!user) {
      return res.status(404).json(ApiResponse.Error('User not found on waitlist'));
    }

    const position = await getPosition(user);
    const totalUsers = await WaitlistUser.count();
    const peopleAhead = position - 1;

    // Get referral stats
    const referrals = await Referral.count({
      where: { referrer_user_id: user.id, is_valid: true }
    });

    return res.status(200).json(ApiResponse.Success({
      id: user.id,
      email: maskEmail(user.email),
      referralCode: user.referral_code,
      referralLink: `https://www.rivenapp.com/?ref=${user.referral_code}`,
      position,
      peopleAhead,
      totalUsers,
      percentile: totalUsers > 0 ? Math.round((1 - (position / totalUsers)) * 100) : 100,
      referralsCount: user.referrals_count,
      joinedAt: user.created_at,
      rewards: getRewards(user.referrals_count)
    }));

  } catch (error) {
    logger.error('Get position error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get position'));
  }
};

/**
 * Get Waitlist Stats - Public stats
 */
const getStats = async (req, res) => {
  try {
    const totalUsers = await WaitlistUser.count();
    const totalReferrals = await Referral.count({ where: { is_valid: true } });

    // Today's signups
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySignups = await WaitlistUser.count({
      where: { created_at: { [Op.gte]: today } }
    });

    return res.status(200).json(ApiResponse.Success({
      totalUsers,
      totalReferrals,
      todaySignups,
      avgReferrals: totalUsers > 0 ? (totalReferrals / totalUsers).toFixed(1) : 0
    }));

  } catch (error) {
    logger.error('Get stats error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get stats'));
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const showFullEmail = req.query.full === 'true';

    const topUsers = await WaitlistUser.findAll({
      order: [['referrals_count', 'DESC'], ['created_at', 'ASC']],
      limit,
      attributes: ['id', 'email', 'referrals_count', 'referral_code', 'created_at']
    });

    const leaderboard = topUsers.map((user, index) => ({
      rank: index + 1,
      email: showFullEmail ? user.email : maskEmail(user.email),
      referralCode: user.referral_code,
      referralsCount: user.referrals_count,
      joinedAt: user.created_at
    }));

    return res.status(200).json(ApiResponse.Success({
      leaderboard,
      totalParticipants: await WaitlistUser.count()
    }));

  } catch (error) {
    logger.error('Get leaderboard error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get leaderboard'));
  }
};

/**
 * Check Referral Code - Validate before signup
 */
const checkReferralCode = async (req, res) => {
  try {
    const { code } = req.params;

    const referrer = await WaitlistUser.findOne({
      where: { referral_code: code }
    });

    if (!referrer) {
      return res.status(404).json(ApiResponse.Error('Invalid referral code'));
    }

    return res.status(200).json(ApiResponse.Success({
      valid: true,
      referrer: maskEmail(referrer.email)
    }));

  } catch (error) {
    logger.error('Check referral error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to validate code'));
  }
};

/**
 * Verify Email - Optional email verification
 */
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json(ApiResponse.Error('Token is required'));
    }

    const user = await WaitlistUser.findOne({
      where: {
        verification_token: token,
        verification_expires: { [Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.status(400).json(ApiResponse.Error('Invalid or expired token'));
    }

    await user.update({
      verified: true,
      status: 'verified',
      verification_token: null
    });

    const position = await getPosition(user);

    return res.status(200).json(ApiResponse.Success({
      email: user.email,
      verified: true,
      position
    }, 'Email verified successfully!'));

  } catch (error) {
    logger.error('Verify email error:', error);
    return res.status(500).json(ApiResponse.Error('Verification failed'));
  }
};

/**
 * Resend Verification - Send new verification email
 */
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await WaitlistUser.findOne({
      where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
      return res.status(404).json(ApiResponse.Error('Email not found'));
    }

    if (user.verified) {
      return res.status(200).json(ApiResponse.Success({ verified: true }, 'Already verified'));
    }

    // Generate new token
    const token = crypto.randomBytes(32).toString('hex');
    await user.update({
      verification_token: token,
      verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    // Would send email here
    logger.info(`Verification token generated for ${email}: ${token}`);

    return res.status(200).json(ApiResponse.Success({
      email: user.email
    }, 'Verification email sent'));

  } catch (error) {
    logger.error('Resend verification error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to send verification'));
  }
};

/**
 * Admin: Invite to Beta
 */
const inviteToBeta = async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 10, 1000);

    const users = await WaitlistUser.findAll({
      where: { status: 'verified' },
      order: [['referrals_count', 'DESC'], ['created_at', 'ASC']],
      limit: count
    });

    if (users.length === 0) {
      return res.status(200).json(ApiResponse.Success({ invitedCount: 0 }, 'No eligible users'));
    }

    const userIds = users.map(u => u.id);
    await WaitlistUser.update(
      { status: 'beta_invited' },
      { where: { id: { [Op.in]: userIds } } }
    );

    logger.info(`Invited ${users.length} users to beta`);

    return res.status(200).json(ApiResponse.Success({
      invitedCount: users.length,
      users: users.map(u => maskEmail(u.email))
    }, `Invited ${users.length} users to beta`));

  } catch (error) {
    logger.error('Invite to beta error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to invite users'));
  }
};

// Helper: Calculate position (rank)
const getPosition = async (user) => {
  // Position = users with more referrals + users with same referrals who joined earlier
  const betterUsers = await WaitlistUser.count({
    where: {
      [Op.or]: [
        { referrals_count: { [Op.gt]: user.referrals_count } },
        {
          referrals_count: user.referrals_count,
          created_at: { [Op.lt]: user.created_at }
        }
      ]
    }
  });
  return betterUsers + 1;
};

// Helper: Mask email
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  const masked = local.length > 2
    ? local[0] + '***' + local.slice(-1)
    : local[0] + '***';
  return `${masked}@${domain}`;
};

// Helper: Get rewards based on referral count
const getRewards = (count) => {
  const tiers = [
    { min: 1, reward: 'Priority Access' },
    { min: 3, reward: 'Skip 50 Spots' },
    { min: 5, reward: 'Early Beta Access' },
    { min: 10, reward: 'Premium Features (1 month free)' },
    { min: 25, reward: 'VIP Status' }
  ];

  const earned = tiers.filter(t => count >= t.min);
  const next = tiers.find(t => count < t.min);

  return {
    earned: earned.map(t => t.reward),
    next: next ? {
      reward: next.reward,
      referralsNeeded: next.min - count
    } : null
  };
};

module.exports = {
  joinWaitlist,
  verifyEmail,
  resendVerification,
  getPosition: getPositionEndpoint,
  getStats,
  getLeaderboard,
  checkReferralCode,
  inviteToBeta
};
