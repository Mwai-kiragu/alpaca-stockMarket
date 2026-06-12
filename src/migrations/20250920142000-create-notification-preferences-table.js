'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('notification_preferences', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      device_tokens: {
        type: Sequelize.JSONB,
        defaultValue: [],
        allowNull: false
      },
      // Channel preferences
      push_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      email_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      sms_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      // Notification type preferences
      security_alerts: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      transaction_alerts: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      account_updates: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      kyc_updates: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      price_alerts: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      portfolio_updates: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      news_updates: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      marketing_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      research_updates: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      // Timing preferences
      quiet_hours_enabled: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      },
      quiet_hours_start: {
        type: Sequelize.TIME,
        allowNull: true
      },
      quiet_hours_end: {
        type: Sequelize.TIME,
        allowNull: true
      },
      timezone: {
        type: Sequelize.STRING(50),
        defaultValue: 'UTC',
        allowNull: false
      },
      // Frequency preferences
      digest_frequency: {
        type: Sequelize.ENUM('real_time', 'hourly', 'daily', 'weekly', 'never'),
        defaultValue: 'real_time',
        allowNull: false
      },
      // Security preferences
      require_biometric_for_critical: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      // Custom thresholds
      price_alert_threshold: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 5.00,
        allowNull: false
      },
      portfolio_alert_threshold: {
        type: Sequelize.DECIMAL(5, 2),
        defaultValue: 10.00,
        allowNull: false
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      }
    });

    // Add index
    await queryInterface.addIndex('notification_preferences', ['user_id'], { unique: true });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('notification_preferences');
  }
};