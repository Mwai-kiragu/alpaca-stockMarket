'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Adding documents_id_front enum value...');

      // Add new enum value for documents_id_front step
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'documents_id_front';
      `);

      console.log('Successfully added documents_id_front step enum value');

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