'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS account_mode VARCHAR(10) NOT NULL DEFAULT 'demo',
        ADD COLUMN IF NOT EXISTS demo_balance DECIMAL(15,2) NOT NULL DEFAULT 10000.00;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'account_mode');
    await queryInterface.removeColumn('users', 'demo_balance');
  }
};
