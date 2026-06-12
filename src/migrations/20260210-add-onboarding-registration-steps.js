'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Add new enum values for the updated onboarding flow
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'source_of_wealth';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'investing_savings';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'disclosures';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'investment_experience';
      `);

      console.log('New onboarding registration step enum values added successfully');
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
