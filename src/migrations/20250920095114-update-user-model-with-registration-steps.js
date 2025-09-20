'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add new columns to users table
    await queryInterface.addColumn('users', 'date_of_birth', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('users', 'gender', {
      type: Sequelize.ENUM('male', 'female', 'other'),
      allowNull: true
    });

    await queryInterface.addColumn('users', 'address', {
      type: Sequelize.TEXT,
      allowNull: true
    });

    await queryInterface.addColumn('users', 'city', {
      type: Sequelize.STRING(100),
      allowNull: true
    });

    await queryInterface.addColumn('users', 'county', {
      type: Sequelize.STRING(100),
      allowNull: true
    });

    await queryInterface.addColumn('users', 'postal_code', {
      type: Sequelize.STRING(20),
      allowNull: true
    });

    await queryInterface.addColumn('users', 'citizenship', {
      type: Sequelize.STRING(3),
      defaultValue: 'KE'
    });

    await queryInterface.addColumn('users', 'occupation', {
      type: Sequelize.STRING(100),
      allowNull: true
    });

    await queryInterface.addColumn('users', 'registration_step', {
      type: Sequelize.ENUM('email_verification', 'personal_info', 'phone_verification', 'address_info', 'kyc_verification', 'kyc_pending', 'kyc_under_review', 'completed'),
      defaultValue: 'email_verification'
    });

    await queryInterface.addColumn('users', 'account_status', {
      type: Sequelize.ENUM('pending', 'active', 'suspended', 'closed'),
      defaultValue: 'pending'
    });

    // Update kyc_status enum to include new values
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_users_kyc_status ADD VALUE 'not_started';
      ALTER TYPE enum_users_kyc_status ADD VALUE 'under_review';
    `);

    // Update existing users to have the new default values
    await queryInterface.sequelize.query(`
      UPDATE users SET
        kyc_status = 'not_started',
        registration_step = 'email_verification',
        account_status = 'pending',
        citizenship = 'KE'
      WHERE kyc_status = 'pending' AND registration_step IS NULL;
    `);
  },

  async down (queryInterface, Sequelize) {
    // Remove added columns
    await queryInterface.removeColumn('users', 'date_of_birth');
    await queryInterface.removeColumn('users', 'gender');
    await queryInterface.removeColumn('users', 'address');
    await queryInterface.removeColumn('users', 'city');
    await queryInterface.removeColumn('users', 'county');
    await queryInterface.removeColumn('users', 'postal_code');
    await queryInterface.removeColumn('users', 'citizenship');
    await queryInterface.removeColumn('users', 'occupation');
    await queryInterface.removeColumn('users', 'registration_step');
    await queryInterface.removeColumn('users', 'account_status');

    // Note: PostgreSQL doesn't support removing enum values easily
    // In production, you might need to create a new enum type and migrate data
  }
};
