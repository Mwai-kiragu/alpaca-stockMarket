'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Updating users from documents step to documents_id_front step...');

      // Update all users with documents step to documents_id_front
      const result = await queryInterface.sequelize.query(`
        UPDATE users
        SET registration_step = 'documents_id_front'
        WHERE registration_step = 'documents';
      `);

      console.log('Successfully updated users from documents to documents_id_front step');

    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Rolling back users from documents_id_front step to documents step...');

      // Revert back to documents if needed
      await queryInterface.sequelize.query(`
        UPDATE users
        SET registration_step = 'documents'
        WHERE registration_step = 'documents_id_front';
      `);

      console.log('Successfully rolled back users to documents step');

    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};