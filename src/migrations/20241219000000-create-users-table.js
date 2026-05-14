'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TYPE "enum_users_gender" AS ENUM ('male', 'female', 'other', 'not_specified');
      CREATE TYPE "enum_users_registration_step" AS ENUM (
        'email_verification', 'personal_info', 'employment_info', 'source_of_wealth',
        'investing_savings', 'disclosures', 'tax_info', 'phone_verification',
        'address_info', 'kyc_verification', 'investment_experience', 'trusted_contact',
        'documents', 'documents_id_front', 'documents_id_back', 'documents_proof_address',
        'agreements', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed'
      );
      CREATE TYPE "enum_users_kyc_status" AS ENUM ('not_started', 'pending', 'submitted', 'approved', 'rejected', 'under_review');
      CREATE TYPE "enum_users_account_status" AS ENUM ('pending', 'active', 'suspended', 'closed');
      CREATE TYPE "enum_users_role" AS ENUM ('user', 'admin', 'support');
      CREATE TYPE "enum_users_status" AS ENUM ('active', 'suspended', 'closed');
      CREATE TYPE "enum_users_registration_status" AS ENUM ('started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed');
    `);

    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      first_name: { type: Sequelize.STRING(100), allowNull: false },
      last_name: { type: Sequelize.STRING(100), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      phone: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      password: { type: Sequelize.STRING(255), allowNull: false },
      is_email_verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_phone_verified: { type: Sequelize.BOOLEAN, defaultValue: false },
      date_of_birth: { type: Sequelize.DATE, allowNull: true },
      gender: { type: Sequelize.ENUM('male', 'female', 'other', 'not_specified'), allowNull: true, defaultValue: 'not_specified' },
      address: { type: Sequelize.TEXT, allowNull: true },
      city: { type: Sequelize.STRING(100), allowNull: true },
      county: { type: Sequelize.STRING(100), allowNull: true },
      postal_code: { type: Sequelize.STRING(20), allowNull: true },
      citizenship: { type: Sequelize.STRING(100), defaultValue: 'Kenya' },
      occupation: { type: Sequelize.STRING(100), allowNull: true },
      registration_step: {
        type: Sequelize.ENUM(
          'email_verification', 'personal_info', 'employment_info', 'source_of_wealth',
          'investing_savings', 'disclosures', 'tax_info', 'phone_verification',
          'address_info', 'kyc_verification', 'investment_experience', 'trusted_contact',
          'documents', 'documents_id_front', 'documents_id_back', 'documents_proof_address',
          'agreements', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed'
        ),
        defaultValue: 'email_verification'
      },
      kyc_status: { type: Sequelize.ENUM('not_started', 'pending', 'submitted', 'approved', 'rejected', 'under_review'), defaultValue: 'not_started' },
      kyc_data: { type: Sequelize.JSONB, defaultValue: {} },
      account_status: { type: Sequelize.ENUM('pending', 'active', 'suspended', 'closed'), defaultValue: 'pending' },
      alpaca_account_id: { type: Sequelize.STRING(255), unique: true, allowNull: true },
      mystocks_sub_account_id: { type: Sequelize.STRING(255), unique: true, allowNull: true },
      role: { type: Sequelize.ENUM('user', 'admin', 'support'), defaultValue: 'user' },
      status: { type: Sequelize.ENUM('active', 'suspended', 'closed'), defaultValue: 'active' },
      last_login: { type: Sequelize.DATE, allowNull: true },
      login_attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      lock_until: { type: Sequelize.DATE, allowNull: true },
      biometric_enabled: { type: Sequelize.BOOLEAN, defaultValue: false },
      pin_enabled: { type: Sequelize.BOOLEAN, defaultValue: false },
      two_factor_enabled: { type: Sequelize.BOOLEAN, defaultValue: false },
      auto_convert_deposits: { type: Sequelize.BOOLEAN, defaultValue: true },
      pin_hash: { type: Sequelize.STRING(255), allowNull: true },
      security_preferences: {
        type: Sequelize.JSONB,
        defaultValue: { require_biometric_for_login: false, require_biometric_for_transactions: true, biometric_timeout_minutes: 15 }
      },
      terms_accepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      privacy_accepted: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      terms_accepted_at: { type: Sequelize.DATE, allowNull: true },
      privacy_accepted_at: { type: Sequelize.DATE, allowNull: true },
      quiz_answers: { type: Sequelize.JSONB, allowNull: true },
      quiz_completed_at: { type: Sequelize.DATE, allowNull: true },
      registration_status: {
        type: Sequelize.ENUM('started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed'),
        allowNull: false,
        defaultValue: 'started'
      },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
      is_onboarding_complete: { type: Sequelize.BOOLEAN, defaultValue: false },
      referral_code: { type: Sequelize.STRING(20), unique: true, allowNull: true },
      referred_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' } },
      referrals_count: { type: Sequelize.INTEGER, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('users', ['email']);
    await queryInterface.addIndex('users', ['phone']);
    await queryInterface.addIndex('users', ['referred_by']);
    await queryInterface.addIndex('users', ['referrals_count']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_users_gender";
      DROP TYPE IF EXISTS "enum_users_registration_step";
      DROP TYPE IF EXISTS "enum_users_kyc_status";
      DROP TYPE IF EXISTS "enum_users_account_status";
      DROP TYPE IF EXISTS "enum_users_role";
      DROP TYPE IF EXISTS "enum_users_status";
      DROP TYPE IF EXISTS "enum_users_registration_status";
    `);
  }
};
