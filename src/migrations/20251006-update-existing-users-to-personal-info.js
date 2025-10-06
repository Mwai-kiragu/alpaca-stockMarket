'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Update all users with email_verification step to personal_info
      await queryInterface.sequelize.query(`
        UPDATE users
        SET registration_step = 'personal_info'
        WHERE registration_step = 'email_verification';
      `);

      console.log('Updated existing users from email_verification to personal_info step');
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      // Revert back to email_verification if needed
      await queryInterface.sequelize.query(`
        UPDATE users
        SET registration_step = 'email_verification'
        WHERE registration_step = 'personal_info';
      `);

      console.log('Reverted users back to email_verification step');
    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};