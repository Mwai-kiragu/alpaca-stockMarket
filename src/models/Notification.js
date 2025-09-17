const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Notification extends Model {}

Notification.init({
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
  type: {
    type: DataTypes.ENUM(
      'order_filled',
      'order_cancelled',
      'order_rejected',
      'deposit_successful',
      'deposit_failed',
      'withdrawal_successful',
      'withdrawal_failed',
      'kyc_approved',
      'kyc_rejected',
      'account_suspended',
      'security_alert',
      'market_update',
      'system_maintenance',
      'promotional'
    ),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  channels: {
    type: DataTypes.JSONB,
    defaultValue: {
      push: true,
      email: false,
      sms: false
    }
  },
  delivery_status: {
    type: DataTypes.JSONB,
    defaultValue: {
      push: { status: 'pending', sent_at: null, error: null },
      email: { status: 'pending', sent_at: null, error: null },
      sms: { status: 'pending', sent_at: null, error: null }
    }
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'Notification',
  tableName: 'notifications',
  indexes: [
    {
      fields: ['user_id', 'created_at']
    },
    {
      fields: ['user_id', 'is_read']
    },
    {
      fields: ['type']
    },
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = Notification;