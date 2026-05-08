'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add verification_code column to email_verification_tokens table
    await queryInterface.addColumn('email_verification_tokens', 'verification_code', {
      type: Sequelize.STRING(10),
      allowNull: true
    });

    // Create phone_verification_tokens table
    await queryInterface.createTable('phone_verification_tokens', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      verification_code: {
        type: Sequelize.STRING(10),
        allowNull: false
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      used: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes for phone_verification_tokens
    await queryInterface.addIndex('phone_verification_tokens', ['user_id']);
    await queryInterface.addIndex('phone_verification_tokens', ['verification_code']);
    await queryInterface.addIndex('phone_verification_tokens', ['expires_at']);
  },

  async down (queryInterface, Sequelize) {
    // Remove verification_code column from email_verification_tokens
    await queryInterface.removeColumn('email_verification_tokens', 'verification_code');

    // Drop phone_verification_tokens table
    await queryInterface.dropTable('phone_verification_tokens');
  }
};
