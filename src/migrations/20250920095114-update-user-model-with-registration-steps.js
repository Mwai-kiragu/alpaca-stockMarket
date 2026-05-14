'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TIMESTAMPTZ;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS county VARCHAR(100);`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS occupation VARCHAR(100);`);

    // gender, registration_step, account_status, citizenship already handled in create-users migration
    await queryInterface.sequelize.query(`ALTER TYPE "enum_users_kyc_status" ADD VALUE IF NOT EXISTS 'not_started';`);
    await queryInterface.sequelize.query(`ALTER TYPE "enum_users_kyc_status" ADD VALUE IF NOT EXISTS 'under_review';`);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'date_of_birth');
    await queryInterface.removeColumn('users', 'address');
    await queryInterface.removeColumn('users', 'city');
    await queryInterface.removeColumn('users', 'county');
    await queryInterface.removeColumn('users', 'postal_code');
    await queryInterface.removeColumn('users', 'occupation');
  }
};
