'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_users_gender" AS ENUM ('male','female','other','not_specified');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS gender "enum_users_gender" DEFAULT 'not_specified';

      DO $$ BEGIN
        CREATE TYPE "enum_users_account_status" AS ENUM ('pending','active','suspended','closed');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status "enum_users_account_status" DEFAULT 'pending';
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS gender;
      ALTER TABLE users DROP COLUMN IF EXISTS account_status;
      DROP TYPE IF EXISTS "enum_users_gender";
      DROP TYPE IF EXISTS "enum_users_account_status";
    `);
  }
};
