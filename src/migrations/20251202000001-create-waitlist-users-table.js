'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('waitlist_users', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      phone: {
        type: Sequelize.STRING(20),
        allowNull: true
      },
      referral_code: {
        type: Sequelize.STRING(20),
        allowNull: false,
        unique: true
      },
      referred_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'waitlist_users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      referrals_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      score: {
        type: Sequelize.BIGINT,
        defaultValue: 0
      },
      rank: {
        type: Sequelize.INTEGER,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('pending', 'verified', 'beta_invited', 'active', 'removed'),
        defaultValue: 'pending'
      },
      verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      verification_token: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      verification_expires: {
        type: Sequelize.DATE,
        allowNull: true
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true
      },
      device_fingerprint: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSONB,
        defaultValue: {}
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

    // Add indexes
    await queryInterface.addIndex('waitlist_users', ['email'], { unique: true });
    await queryInterface.addIndex('waitlist_users', ['referral_code'], { unique: true });
    await queryInterface.addIndex('waitlist_users', ['referred_by']);
    await queryInterface.addIndex('waitlist_users', ['status']);
    await queryInterface.addIndex('waitlist_users', ['verified']);
    await queryInterface.addIndex('waitlist_users', ['score']);
    await queryInterface.addIndex('waitlist_users', ['referrals_count']);
    await queryInterface.addIndex('waitlist_users', ['created_at']);
    await queryInterface.addIndex('waitlist_users', ['ip_address']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('waitlist_users');
  }
};
