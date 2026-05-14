'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS mystocks_sub_account_id VARCHAR(255);`);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_mystocks_sub_account_id_unique
        ON users (mystocks_sub_account_id) WHERE mystocks_sub_account_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'mystocks_sub_account_id');
  }
};
