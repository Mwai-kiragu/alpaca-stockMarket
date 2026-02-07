const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { sequelize } = require('../config/database');

class User extends Model {
  // Generate unique referral code
  static generateReferralCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars (0,O,1,I)
    let code = 'RIVEN';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
  async comparePassword(candidatePassword) {
    if (!this.password) return false;
    return bcrypt.compare(candidatePassword, this.password);
  }

  async incLoginAttempts() {
    const updates = { login_attempts: this.login_attempts + 1 };

    if (this.lock_until && this.lock_until < new Date()) {
      updates.login_attempts = 1;
      updates.lock_until = null;
    }

    if (this.login_attempts + 1 >= 5 && !this.isLocked) {
      updates.lock_until = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    }

    return this.update(updates);
  }

  get isLocked() {
    return !!(this.lock_until && this.lock_until > new Date());
  }

  get fullName() {
    return `${this.first_name} ${this.last_name}`;
  }
}

User.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
      // Removed isEmail validation - handled in middleware instead
      // This allows Gmail aliases like user+tag@gmail.com
    }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      len: [6, 255]
    }
  },
  is_email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_phone_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  date_of_birth: {
    type: DataTypes.DATE,
    allowNull: true
  },
  gender: {
    type: DataTypes.ENUM('male', 'female', 'other', 'not_specified'),
    allowNull: true,
    defaultValue: 'not_specified'
  },
  address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  county: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  postal_code: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  citizenship: {
    type: DataTypes.STRING(100),
    defaultValue: 'Kenya'
  },
  occupation: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  registration_step: {
    type: DataTypes.ENUM('email_verification', 'personal_info', 'employment_info', 'tax_info', 'phone_verification', 'address_info', 'kyc_verification', 'trusted_contact', 'documents', 'documents_id_front', 'documents_id_back', 'documents_proof_address', 'agreements', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed'),
    defaultValue: 'email_verification'
  },
  kyc_status: {
    type: DataTypes.ENUM('not_started', 'pending', 'submitted', 'approved', 'rejected', 'under_review'),
    defaultValue: 'not_started'
  },
  kyc_data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  account_status: {
    type: DataTypes.ENUM('pending', 'active', 'suspended', 'closed'),
    defaultValue: 'pending'
  },
  alpaca_account_id: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true
  },
  role: {
    type: DataTypes.ENUM('user', 'admin', 'support'),
    defaultValue: 'user'
  },
  status: {
    type: DataTypes.ENUM('active', 'suspended', 'closed'),
    defaultValue: 'active'
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true
  },
  login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lock_until: {
    type: DataTypes.DATE,
    allowNull: true
  },
  biometric_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pin_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  two_factor_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  auto_convert_deposits: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Automatically convert KES deposits to USD using real-time exchange rates'
  },
  pin_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  security_preferences: {
    type: DataTypes.JSONB,
    defaultValue: {
      require_biometric_for_login: false,
      require_biometric_for_transactions: true,
      biometric_timeout_minutes: 15
    }
  },
  terms_accepted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  privacy_accepted: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  terms_accepted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  privacy_accepted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  quiz_answers: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null
  },
  quiz_completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  registration_status: {
    type: DataTypes.ENUM('started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed'),
    allowNull: false,
    defaultValue: 'started'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  is_onboarding_complete: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Referral system fields
  referral_code: {
    type: DataTypes.STRING(20),
    unique: true,
    allowNull: true
  },
  referred_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  referrals_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }

}, {
  sequelize,
  modelName: 'User',
  tableName: 'users',
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
      // Generate referral code for new users
      if (!user.referral_code) {
        let code;
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 10) {
          code = User.generateReferralCode();
          const existing = await User.findOne({ where: { referral_code: code } });
          exists = !!existing;
          attempts++;
        }
        user.referral_code = code;
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    afterCreate: async (user) => {
      // If user was referred, increment referrer's count
      if (user.referred_by) {
        await User.increment('referrals_count', {
          where: { id: user.referred_by }
        });
      }
    }
  },
  indexes: [
    {
      fields: ['email']
    },
    {
      fields: ['phone']
    },
    {
      fields: ['alpaca_account_id'],
      unique: true,
      where: {
        alpaca_account_id: {
          [sequelize.Sequelize.Op.ne]: null
        }
      }
    },
    {
      fields: ['referral_code'],
      unique: true,
      where: {
        referral_code: {
          [sequelize.Sequelize.Op.ne]: null
        }
      }
    },
    {
      fields: ['referred_by']
    },
    {
      fields: ['referrals_count']
    }
  ]
});

module.exports = User;