'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_users_account_mode" AS ENUM ('demo', 'real');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      ALTER TABLE users
        ALTER COLUMN account_mode DROP DEFAULT,
        ALTER COLUMN account_mode TYPE "enum_users_account_mode"
          USING account_mode::text::"enum_users_account_mode",
        ALTER COLUMN account_mode SET DEFAULT 'demo';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ALTER COLUMN account_mode DROP DEFAULT,
        ALTER COLUMN account_mode TYPE VARCHAR(10) USING account_mode::text,
        ALTER COLUMN account_mode SET DEFAULT 'demo';
      DROP TYPE IF EXISTS "enum_users_account_mode";
    `);
  }
};
