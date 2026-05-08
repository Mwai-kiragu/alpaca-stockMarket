const { DataTypes, Model } = require('sequelize');
const crypto = require('crypto');
const { sequelize } = require('../config/database');

class PasswordResetToken extends Model {
  static generateToken() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  isExpired() {
    return new Date() > this.expires_at;
  }
}

PasswordResetToken.init({
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
  used: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'PasswordResetToken',
  tableName: 'password_reset_tokens',
  indexes: [
    {
      fields: ['token']
    },
    {
      fields: ['user_id']
    }
  ]
});

module.exports = PasswordResetToken;