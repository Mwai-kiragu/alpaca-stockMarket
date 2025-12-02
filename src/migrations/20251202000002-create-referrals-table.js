'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('referrals', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      referrer_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'waitlist_users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      referred_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'waitlist_users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      referred_email: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      is_valid: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      is_verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true
      },
      fraud_flags: {
        type: Sequelize.JSONB,
        defaultValue: {}
      },
      status: {
        type: Sequelize.ENUM('pending', 'verified', 'invalid', 'fraud'),
        defaultValue: 'pending'
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
    await queryInterface.addIndex('referrals', ['referrer_user_id']);
    await queryInterface.addIndex('referrals', ['referred_user_id']);
    await queryInterface.addIndex('referrals', ['referred_email']);
    await queryInterface.addIndex('referrals', ['is_valid']);
    await queryInterface.addIndex('referrals', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('referrals');
  }
};
