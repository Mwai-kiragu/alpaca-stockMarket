'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // Check if column exists first
      const tableDesc = await queryInterface.describeTable('users');

      if (!tableDesc.registration_step) {
        // Create the enum type first if it doesn't exist
        await queryInterface.sequelize.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_registration_step') THEN
              CREATE TYPE "enum_users_registration_step" AS ENUM (
                'email_verification',
                'personal_info',
                'employment_info',
                'phone_verification',
                'address_info',
                'kyc_verification',
                'trusted_contact',
                'documents',
                'agreements',
                'kyc_pending',
                'kyc_under_review',
                'completed',
                'initial_completed'
              );
            END IF;
          END
          $$;
        `);

        // Add the column
        await queryInterface.addColumn('users', 'registration_step', {
          type: 'enum_users_registration_step',
          defaultValue: 'email_verification',
          allowNull: false
        });

        console.log('registration_step column added successfully');
      } else {
        console.log('registration_step column already exists');
      }
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      await queryInterface.removeColumn('users', 'registration_step');
      console.log('registration_step column removed successfully');
    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};