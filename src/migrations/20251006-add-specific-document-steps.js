'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Adding specific document step enum values...');

      // Add new enum values for specific document steps
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'documents_id_back';
      `);

      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'documents_proof_address';
      `);

      console.log('Successfully added specific document step enum values');

    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Note: PostgreSQL does not support dropping enum values directly.');
      console.log('Rollback completed - enum values remain for data integrity.');

    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};