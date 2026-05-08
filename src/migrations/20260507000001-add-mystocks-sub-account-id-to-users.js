'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'mystocks_sub_account_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
      defaultValue: null,
      unique: true
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'mystocks_sub_account_id');
  }
};
