'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'pin_enabled', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'pin_enabled');
  }
};
