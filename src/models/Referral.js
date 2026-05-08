const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Referral extends Model {}

Referral.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referrer_user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'waitlist_users',
      key: 'id'
    }
  },
  referred_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'waitlist_users',
      key: 'id'
    }
  },
  referred_email: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  is_valid: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  fraud_flags: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  status: {
    type: DataTypes.ENUM('pending', 'verified', 'invalid', 'fraud'),
    defaultValue: 'pending'
  }
}, {
  sequelize,
  modelName: 'Referral',
  tableName: 'referrals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['referrer_user_id'] },
    { fields: ['referred_user_id'] },
    { fields: ['referred_email'] },
    { fields: ['is_valid'] },
    { fields: ['status'] }
  ]
});

module.exports = Referral;
