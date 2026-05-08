'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new gender option to enum
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_gender" ADD VALUE IF NOT EXISTS 'not_specified';
    `);

    // Add new registration_step option to enum
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'initial_completed';
    `);

    // Add new columns
    await queryInterface.addColumn('users', 'terms_accepted', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn('users', 'privacy_accepted', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    await queryInterface.addColumn('users', 'terms_accepted_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('users', 'privacy_accepted_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    await queryInterface.addColumn('users', 'quiz_answers', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn('users', 'quiz_completed_at', {
      type: Sequelize.DATE,
      allowNull: true
    });

    // Create registration_status enum type
    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_users_registration_status" AS ENUM (
        'started',
        'email_verified',
        'phone_verified',
        'quiz_completed',
        'documents_uploaded',
        'completed'
      );
    `);

    await queryInterface.addColumn('users', 'registration_status', {
      type: Sequelize.ENUM('started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed'),
      allowNull: false,
      defaultValue: 'started'
    });

    // Update gender default value
    await queryInterface.changeColumn('users', 'gender', {
      type: Sequelize.ENUM('male', 'female', 'other', 'not_specified'),
      allowNull: true,
      defaultValue: 'not_specified'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove new columns
    await queryInterface.removeColumn('users', 'terms_accepted');
    await queryInterface.removeColumn('users', 'privacy_accepted');
    await queryInterface.removeColumn('users', 'terms_accepted_at');
    await queryInterface.removeColumn('users', 'privacy_accepted_at');
    await queryInterface.removeColumn('users', 'quiz_answers');
    await queryInterface.removeColumn('users', 'quiz_completed_at');
    await queryInterface.removeColumn('users', 'registration_status');

    // Drop the enum type
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_registration_status";');
  }
};