'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Add new enum values one by one
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'employment_info';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'trusted_contact';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'documents';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'agreements';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'initial_completed';
      `);

      console.log('Registration step enum values added successfully');
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    // PostgreSQL doesn't support removing enum values easily
    // In production, you would need to create a new enum type and migrate data
    console.log('Note: PostgreSQL does not support removing enum values. Manual intervention required.');
  }
};