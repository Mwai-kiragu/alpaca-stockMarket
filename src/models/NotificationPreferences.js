const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class NotificationPreferences extends Model {
  static async getPreferences(userId) {
    let preferences = await this.findOne({ where: { user_id: userId } });

    if (!preferences) {
      // Create default preferences if none exist
      preferences = await this.create({
        user_id: userId,
        push_enabled: true,
        email_enabled: true,
        sms_enabled: true,
        marketing_enabled: false,
        security_alerts: true,
        transaction_alerts: true,
        kyc_updates: true,
        account_updates: true,
        price_alerts: true,
        news_updates: false
      });
    }

    return preferences;
  }

  async updatePreferences(updates) {
    return this.update(updates);
  }

  shouldSendNotification(type, channel) {
    const channelEnabled = this[`${channel}_enabled`];
    const typeEnabled = this[type];

    // Security alerts always sent regardless of preferences (for safety)
    if (type === 'security_alerts') {
      return channelEnabled;
    }

    return channelEnabled && typeEnabled;
  }
}

NotificationPreferences.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  // Device tokens for push notifications
  device_tokens: {
    type: DataTypes.JSONB,
    defaultValue: [],
    comment: 'Array of FCM device tokens for push notifications'
  },
  // Channel preferences
  push_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Enable push notifications'
  },
  email_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Enable email notifications'
  },
  sms_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Enable SMS notifications'
  },
  // Notification type preferences
  security_alerts: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Security and login alerts (cannot be disabled for safety)'
  },
  transaction_alerts: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Buy/sell transaction notifications'
  },
  account_updates: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Account status and KYC updates'
  },
  kyc_updates: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'KYC verification status updates'
  },
  price_alerts: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Stock price alerts and watchlist notifications'
  },
  portfolio_updates: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Portfolio performance and dividend notifications'
  },
  news_updates: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Market news and analysis'
  },
  marketing_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Marketing and promotional communications'
  },
  research_updates: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Research reports and market insights'
  },
  // Timing preferences
  quiet_hours_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Enable quiet hours for non-urgent notifications'
  },
  quiet_hours_start: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Start time for quiet hours (e.g., 22:00)'
  },
  quiet_hours_end: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'End time for quiet hours (e.g., 08:00)'
  },
  timezone: {
    type: DataTypes.STRING(50),
    defaultValue: 'UTC',
    comment: 'User timezone for proper notification timing'
  },
  // Frequency preferences
  digest_frequency: {
    type: DataTypes.ENUM('real_time', 'hourly', 'daily', 'weekly', 'never'),
    defaultValue: 'real_time',
    comment: 'How often to send digest notifications'
  },
  // Security preferences
  require_biometric_for_critical: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Require biometric confirmation for critical notifications'
  },
  // Custom notification settings
  price_alert_threshold: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 5.00,
    comment: 'Minimum price change percentage to trigger alert'
  },
  portfolio_alert_threshold: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 10.00,
    comment: 'Portfolio value change percentage to trigger alert'
  }
}, {
  sequelize,
  modelName: 'NotificationPreferences',
  tableName: 'notification_preferences',
  indexes: [
    {
      fields: ['user_id'],
      unique: true
    }
  ]
});

module.exports = NotificationPreferences;