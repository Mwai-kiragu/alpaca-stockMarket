const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class BiometricAuth extends Model {
  static async findActiveByUserId(userId) {
    return this.findOne({
      where: {
        user_id: userId,
        is_active: true
      }
    });
  }

  async disable() {
    return this.update({
      is_active: false,
      disabled_at: new Date()
    });
  }
}

BiometricAuth.init({
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
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  device_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  device_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  device_model: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  os_version: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  biometric_type: {
    type: DataTypes.ENUM('fingerprint', 'face', 'voice', 'iris'),
    allowNull: false
  },
  public_key: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  biometric_template_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Hashed biometric template for verification'
  },
  challenge_token: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Current challenge token for biometric verification'
  },
  token_expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  verification_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  max_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  last_used_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  registered_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  disabled_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'BiometricAuth',
  tableName: 'biometric_auths',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['device_id']
    },
    {
      fields: ['user_id', 'device_id'],
      unique: true
    },
    {
      fields: ['challenge_token'],
      unique: true,
      where: {
        challenge_token: {
          [sequelize.Sequelize.Op.ne]: null
        }
      }
    }
  ]
});

module.exports = BiometricAuth;