const { User, UserReferral } = require('../models');
const { Op } = require('sequelize');
const logger = require('../utils/logger');

// API Response Helper
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
 * Get user's referral info
 * GET /api/v1/referral
 */
const getReferralInfo = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findByPk(userId, {
      attributes: ['id', 'referral_code', 'referrals_count', 'referred_by', 'created_at']
    });

    if (!user) {
      return res.status(404).json(ApiResponse.Error('User not found'));
    }

    // Get position (rank based on referrals)
    const position = await getPosition(user);
    const totalUsers = await User.count({ where: { is_onboarding_complete: true } });

    // Get rewards info
    const rewards = getRewards(user.referrals_count);

    return res.status(200).json(ApiResponse.Success({
      referralCode: user.referral_code,
      referralLink: `https://www.rivenapp.com/signup?ref=${user.referral_code}`,
      referralsCount: user.referrals_count,
      position,
      totalUsers,
      percentile: totalUsers > 0 ? Math.round((1 - (position / totalUsers)) * 100) : 100,
      rewards,
      joinedAt: user.created_at
    }));

  } catch (error) {
    logger.error('Get referral info error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get referral info'));
  }
};

/**
 * Get user's referrals list
 * GET /api/v1/referral/list
 */
const getReferralsList = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    // Get users referred by this user
    const { count, rows: referrals } = await User.findAndCountAll({
      where: { referred_by: userId },
      attributes: ['id', 'first_name', 'email', 'created_at', 'is_onboarding_complete'],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const referralsList = referrals.map(ref => ({
      id: ref.id,
      name: ref.first_name,
      email: maskEmail(ref.email),
      joinedAt: ref.created_at,
      status: ref.is_onboarding_complete ? 'completed' : 'pending'
    }));

    return res.status(200).json(ApiResponse.Success({
      referrals: referralsList,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    }));

  } catch (error) {
    logger.error('Get referrals list error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get referrals'));
  }
};

/**
 * Get leaderboard
 * GET /api/v1/referral/leaderboard
 */
const getLeaderboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const topUsers = await User.findAll({
      where: {
        is_onboarding_complete: true,
        referrals_count: { [Op.gt]: 0 }
      },
      order: [['referrals_count', 'DESC'], ['created_at', 'ASC']],
      limit,
      attributes: ['id', 'first_name', 'referrals_count', 'created_at']
    });

    const leaderboard = topUsers.map((user, index) => ({
      rank: index + 1,
      name: user.first_name,
      referralsCount: user.referrals_count,
      isYou: user.id === userId
    }));

    // Find current user's position if not in top list
    const currentUser = await User.findByPk(userId, {
      attributes: ['referrals_count', 'first_name']
    });

    let userPosition = null;
    if (currentUser && !leaderboard.some(u => u.isYou)) {
      const position = await getPosition(currentUser);
      userPosition = {
        rank: position,
        name: currentUser.first_name,
        referralsCount: currentUser.referrals_count,
        isYou: true
      };
    }

    return res.status(200).json(ApiResponse.Success({
      leaderboard,
      userPosition,
      totalParticipants: await User.count({
        where: { is_onboarding_complete: true, referrals_count: { [Op.gt]: 0 } }
      })
    }));

  } catch (error) {
    logger.error('Get leaderboard error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get leaderboard'));
  }
};

/**
 * Validate a referral code
 * GET /api/v1/referral/validate/:code
 */
const validateReferralCode = async (req, res) => {
  try {
    const { code } = req.params;

    const referrer = await User.findOne({
      where: { referral_code: code.toUpperCase() },
      attributes: ['id', 'first_name']
    });

    if (!referrer) {
      return res.status(404).json(ApiResponse.Error('Invalid referral code'));
    }

    return res.status(200).json(ApiResponse.Success({
      valid: true,
      referrerName: referrer.first_name
    }));

  } catch (error) {
    logger.error('Validate referral code error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to validate code'));
  }
};

/**
 * Get referral stats
 * GET /api/v1/referral/stats
 */
const getReferralStats = async (req, res) => {
  try {
    const totalReferrers = await User.count({
      where: { referrals_count: { [Op.gt]: 0 } }
    });

    const totalReferrals = await User.sum('referrals_count') || 0;

    // Today's referrals
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayReferrals = await User.count({
      where: {
        referred_by: { [Op.ne]: null },
        created_at: { [Op.gte]: today }
      }
    });

    return res.status(200).json(ApiResponse.Success({
      totalReferrers,
      totalReferrals,
      todayReferrals,
      avgReferrals: totalReferrers > 0 ? (totalReferrals / totalReferrers).toFixed(1) : 0
    }));

  } catch (error) {
    logger.error('Get referral stats error:', error);
    return res.status(500).json(ApiResponse.Error('Failed to get stats'));
  }
};

// Helper: Calculate position (rank)
const getPosition = async (user) => {
  const betterUsers = await User.count({
    where: {
      is_onboarding_complete: true,
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
    { min: 1, reward: 'Priority Support', icon: '⭐' },
    { min: 3, reward: 'Reduced Fees (1 month)', icon: '💰' },
    { min: 5, reward: 'Premium Features', icon: '🚀' },
    { min: 10, reward: 'VIP Status', icon: '👑' },
    { min: 25, reward: 'Lifetime Benefits', icon: '💎' }
  ];

  const earned = tiers.filter(t => count >= t.min);
  const next = tiers.find(t => count < t.min);

  return {
    earned: earned.map(t => ({ reward: t.reward, icon: t.icon })),
    next: next ? {
      reward: next.reward,
      icon: next.icon,
      referralsNeeded: next.min - count
    } : null,
    totalTiers: tiers.length,
    completedTiers: earned.length
  };
};

module.exports = {
  getReferralInfo,
  getReferralsList,
  getLeaderboard,
  validateReferralCode,
  getReferralStats
};
