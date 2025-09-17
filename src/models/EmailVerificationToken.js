const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

class EmailVerificationToken extends Model {
  static generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  isExpired() {
    return new Date() > this.expires_at;
  }
}

EmailVerificationToken.init({
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
  token: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
  },
  used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'EmailVerificationToken',
  tableName: 'email_verification_tokens',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['token'],
      unique: true
    },
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = EmailVerificationToken;