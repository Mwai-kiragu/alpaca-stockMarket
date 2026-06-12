const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class PhoneVerificationToken extends Model {
  isExpired() {
    return new Date() > this.expires_at;
  }
}

PhoneVerificationToken.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  verification_code: {
    type: DataTypes.STRING(10),
    allowNull: false
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
  },
  used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'PhoneVerificationToken',
  tableName: 'phone_verification_tokens',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['verification_code']
    },
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = PhoneVerificationToken;