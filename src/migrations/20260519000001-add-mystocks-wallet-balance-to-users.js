'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'mystocks_wallet_balance', {
      type: Sequelize.DECIMAL(18, 8),
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'mystocks_wallet_balance');
  }
};
