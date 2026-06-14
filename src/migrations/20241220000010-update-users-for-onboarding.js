'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      // Check if users table exists, if not create it
      const tableInfo = await queryInterface.describeTable('users');

      // Add missing columns if they don't exist
      const columnsToAdd = [];

      if (!tableInfo.kyc_data) {
        columnsToAdd.push({
          name: 'kyc_data',
          definition: {
            type: Sequelize.JSONB,
            allowNull: true,
            defaultValue: {}
          }
        });
      }

      if (!tableInfo.terms_accepted) {
        columnsToAdd.push({
          name: 'terms_accepted',
          definition: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
          }
        });
      }

      if (!tableInfo.privacy_accepted) {
        columnsToAdd.push({
          name: 'privacy_accepted',
          definition: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: false
          }
        });
      }

      if (!tableInfo.terms_accepted_at) {
        columnsToAdd.push({
          name: 'terms_accepted_at',
          definition: {
            type: Sequelize.DATE,
            allowNull: true
          }
        });
      }

      if (!tableInfo.privacy_accepted_at) {
        columnsToAdd.push({
          name: 'privacy_accepted_at',
          definition: {
            type: Sequelize.DATE,
            allowNull: true
          }
        });
      }

      if (!tableInfo.registration_status) {
        columnsToAdd.push({
          name: 'registration_status',
          definition: {
            type: Sequelize.ENUM('started', 'email_verified', 'phone_verified', 'quiz_completed', 'documents_uploaded', 'completed'),
            allowNull: false,
            defaultValue: 'started'
          }
        });
      }

      if (!tableInfo.alpaca_account_id) {
        columnsToAdd.push({
          name: 'alpaca_account_id',
          definition: {
            type: Sequelize.STRING(255),
            allowNull: true,
            unique: true
          }
        });
      }

      // Add all missing columns
      for (const column of columnsToAdd) {
        await queryInterface.addColumn('users', column.name, column.definition);
        console.log(`Added column: ${column.name}`);
      }

      // Update existing ENUM columns to include new values if needed
      if (tableInfo.registration_step) {
        // First remove the default value
        await queryInterface.changeColumn('users', 'registration_step', {
          type: Sequelize.ENUM('email_verification', 'personal_info', 'phone_verification', 'address_info', 'kyc_verification', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed'),
          allowNull: true
        });
        // Then set the new default value
        await queryInterface.changeColumn('users', 'registration_step', {
          type: Sequelize.ENUM('email_verification', 'personal_info', 'phone_verification', 'address_info', 'kyc_verification', 'kyc_pending', 'kyc_under_review', 'completed', 'initial_completed'),
          allowNull: true,
          defaultValue: 'email_verification'
        });
      }

      if (tableInfo.kyc_status) {
        // Rebuild enum to ensure 'not_started' is present. Sequelize's changeColumn
        // generates SET DEFAULT before CREATE TYPE, which fails if the enum already
        // exists without the new value. Use rename/create/alter/drop instead.
        await queryInterface.sequelize.query(`
          DO $$ BEGIN
            -- Check if 'not_started' is already a valid value for this enum
            IF NOT EXISTS (
              SELECT 1 FROM pg_enum e
              JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'enum_users_kyc_status' AND e.enumlabel = 'not_started'
            ) THEN
              ALTER TYPE "enum_users_kyc_status" RENAME TO "enum_users_kyc_status_old";
              CREATE TYPE "enum_users_kyc_status" AS ENUM ('not_started', 'pending', 'submitted', 'approved', 'rejected', 'under_review');
              ALTER TABLE "users"
                ALTER COLUMN "kyc_status" DROP DEFAULT,
                ALTER COLUMN "kyc_status" TYPE "enum_users_kyc_status"
                  USING "kyc_status"::text::"enum_users_kyc_status";
              DROP TYPE "enum_users_kyc_status_old";
            END IF;
          END $$;
        `);
        await queryInterface.sequelize.query(`
          ALTER TABLE "users"
            ALTER COLUMN "kyc_status" DROP NOT NULL,
            ALTER COLUMN "kyc_status" SET DEFAULT 'not_started'
        `);
      }

      // Create unique index on alpaca_account_id if it doesn't exist
      try {
        await queryInterface.addIndex('users', {
          fields: ['alpaca_account_id'],
          unique: true,
          where: {
            alpaca_account_id: {
              [Sequelize.Op.ne]: null
            }
          },
          name: 'users_alpaca_account_id_unique'
        });
      } catch (error) {
        console.log('Index on alpaca_account_id might already exist:', error.message);
      }

      console.log('Users table updated successfully for onboarding system');

    } catch (error) {
      console.error('Error updating users table:', error);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      // Remove added columns
      const columnsToRemove = [
        'kyc_data',
        'terms_accepted',
        'privacy_accepted',
        'terms_accepted_at',
        'privacy_accepted_at',
        'registration_status',
        'alpaca_account_id'
      ];

      for (const column of columnsToRemove) {
        try {
          await queryInterface.removeColumn('users', column);
          console.log(`Removed column: ${column}`);
        } catch (error) {
          console.log(`Column ${column} might not exist:`, error.message);
        }
      }

      // Remove index
      try {
        await queryInterface.removeIndex('users', 'users_alpaca_account_id_unique');
      } catch (error) {
        console.log('Index might not exist:', error.message);
      }

    } catch (error) {
      console.error('Error reverting users table:', error);
      throw error;
    }
  }
};