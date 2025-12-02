const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

class WaitlistUser extends Model {
  // Generate unique referral code
  static generateReferralCode() {
    const randomPart = crypto.randomBytes(4).toString('hex');
    return `riven_${randomPart}`;
  }

  // Calculate user's score for ranking
  calculateScore() {
    // Score formula: referrals_count * 10000 + (MAX_TIMESTAMP - created_at)
    // Higher score = better rank
    const MAX_TIMESTAMP = new Date('2030-01-01').getTime();
    const createdAtTimestamp = new Date(this.created_at).getTime();
    const timeBonus = Math.floor((MAX_TIMESTAMP - createdAtTimestamp) / 1000); // Convert to seconds
    return (this.referrals_count * 10000) + timeBonus;
  }

  // Get user's rank
  async getRank() {
    const score = this.calculateScore();
    const count = await WaitlistUser.count({
      where: {
        [sequelize.Sequelize.Op.and]: [
          sequelize.literal(`(referrals_count * 10000 + EXTRACT(EPOCH FROM (TIMESTAMP '2030-01-01' - created_at))) > ${score}`)
        ]
      }
    });
    return count + 1;
  }

  // Check if email is disposable
  static isDisposableEmail(email) {
    const disposableDomains = [
      'tempmail.com', 'throwaway.com', 'guerrillamail.com', 'mailinator.com',
      'temp-mail.org', 'fakeinbox.com', '10minutemail.com', 'trashmail.com',
      'yopmail.com', 'getnada.com', 'maildrop.cc', 'dispostable.com',
      'sharklasers.com', 'guerrillamail.info', 'grr.la', 'spam4.me',
      'tempail.com', 'emailondeck.com', 'mohmal.com', 'tempinbox.com'
    ];
    const domain = email.split('@')[1]?.toLowerCase();
    return disposableDomains.includes(domain);
  }
}

WaitlistUser.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  referral_code: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true
  },
  referred_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'waitlist_users',
      key: 'id'
    }
  },
  referrals_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  score: {
    type: DataTypes.BIGINT,
    defaultValue: 0
  },
  rank: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'beta_invited', 'active', 'removed'),
    defaultValue: 'pending'
  },
  verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  verification_token: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  verification_expires: {
    type: DataTypes.DATE,
    allowNull: true
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  device_fingerprint: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  sequelize,
  modelName: 'WaitlistUser',
  tableName: 'waitlist_users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['referral_code'], unique: true },
    { fields: ['referred_by'] },
    { fields: ['status'] },
    { fields: ['verified'] },
    { fields: ['score'] },
    { fields: ['referrals_count'] },
    { fields: ['created_at'] }
  ],
  hooks: {
    beforeValidate: async (user) => {
      // Generate referral code if not set (must be before validation)
      if (!user.referral_code) {
        let code;
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 10) {
          code = WaitlistUser.generateReferralCode();
          const existing = await WaitlistUser.findOne({ where: { referral_code: code } });
          exists = !!existing;
          attempts++;
        }
        user.referral_code = code;
      }

      // Calculate initial score
      const MAX_TIMESTAMP = new Date('2030-01-01').getTime();
      const createdAtTimestamp = Date.now();
      user.score = Math.floor((MAX_TIMESTAMP - createdAtTimestamp) / 1000);
    },
    afterCreate: async (user) => {
      // If user was referred, increment referrer's count
      if (user.referred_by) {
        await WaitlistUser.increment('referrals_count', {
          where: { id: user.referred_by }
        });

        // Update referrer's score
        const referrer = await WaitlistUser.findByPk(user.referred_by);
        if (referrer) {
          const MAX_TIMESTAMP = new Date('2030-01-01').getTime();
          const createdAtTimestamp = new Date(referrer.created_at).getTime();
          const newScore = (referrer.referrals_count + 1) * 10000 + Math.floor((MAX_TIMESTAMP - createdAtTimestamp) / 1000);
          await referrer.update({ score: newScore });
        }
      }
    }
  }
});

module.exports = WaitlistUser;
