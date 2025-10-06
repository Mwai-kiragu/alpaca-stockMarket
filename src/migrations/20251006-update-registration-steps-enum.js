'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      // First check and drop the old type if it exists
      await queryInterface.sequelize.query(`
        DROP TYPE IF EXISTS "enum_users_registration_step_old" CASCADE;
      `);

      // Drop the default constraint
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step" DROP DEFAULT;
      `);

      // Rename the old enum type
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" RENAME TO "enum_users_registration_step_old";
      `);

      // Create the new enum type with additional values
      await queryInterface.sequelize.query(`
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
      `);

      // Update the column to use the new enum type
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step"
        TYPE "enum_users_registration_step"
        USING "registration_step"::text::"enum_users_registration_step";
      `);

      // Set the default value back
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step" SET DEFAULT 'email_verification'::"enum_users_registration_step";
      `);

      // Drop the old enum type
      await queryInterface.sequelize.query(`
        DROP TYPE "enum_users_registration_step_old";
      `);

      // Update users who have completed personal_info to move to employment_info
      await queryInterface.sequelize.query(`
        UPDATE "users"
        SET "registration_step" = 'employment_info'
        WHERE "registration_step" = 'personal_info'
        AND "date_of_birth" IS NOT NULL
        AND "address" IS NOT NULL;
      `);

      console.log('Migration completed successfully');
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      // Revert any new enum values to compatible old values
      await queryInterface.sequelize.query(`
        UPDATE "users"
        SET "registration_step" = 'personal_info'
        WHERE "registration_step" IN ('employment_info', 'trusted_contact', 'documents', 'agreements');
      `);

      // Drop default
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step" DROP DEFAULT;
      `);

      // Check and drop old type if exists
      await queryInterface.sequelize.query(`
        DROP TYPE IF EXISTS "enum_users_registration_step_old" CASCADE;
      `);

      // Rename current enum
      await queryInterface.sequelize.query(`
        ALTER TYPE "enum_users_registration_step" RENAME TO "enum_users_registration_step_old";
      `);

      // Create old enum type
      await queryInterface.sequelize.query(`
        CREATE TYPE "enum_users_registration_step" AS ENUM (
          'email_verification',
          'personal_info',
          'phone_verification',
          'address_info',
          'kyc_verification',
          'kyc_pending',
          'kyc_under_review',
          'completed',
          'initial_completed'
        );
      `);

      // Update column to use old enum
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step"
        TYPE "enum_users_registration_step"
        USING "registration_step"::text::"enum_users_registration_step";
      `);

      // Set default back
      await queryInterface.sequelize.query(`
        ALTER TABLE "users"
        ALTER COLUMN "registration_step" SET DEFAULT 'email_verification'::"enum_users_registration_step";
      `);

      // Drop the temporary enum
      await queryInterface.sequelize.query(`
        DROP TYPE "enum_users_registration_step_old";
      `);

      console.log('Migration rolled back successfully');
    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};