'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS mystocks_wallet_balance DECIMAL(18,8) DEFAULT NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'mystocks_wallet_balance');
  }
};
