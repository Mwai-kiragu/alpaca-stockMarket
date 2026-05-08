const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class UserReferral extends Model {}

UserReferral.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  referrer_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  referred_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'rewarded'),
    defaultValue: 'completed'
  },
  reward_tier: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'The reward tier unlocked by this referral'
  }
}, {
  sequelize,
  modelName: 'UserReferral',
  tableName: 'user_referrals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['referrer_id'] },
    { fields: ['referred_id'], unique: true },
    { fields: ['status'] },
    { fields: ['created_at'] }
  ]
});

module.exports = UserReferral;
