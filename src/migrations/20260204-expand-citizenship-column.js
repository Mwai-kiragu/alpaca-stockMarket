'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('users');
    if (tableInfo.citizenship) {
      await queryInterface.changeColumn('users', 'citizenship', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'Kenya'
      });
    } else {
      await queryInterface.addColumn('users', 'citizenship', {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'Kenya'
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('users', 'citizenship', {
      type: Sequelize.STRING(3),
      allowNull: true,
      defaultValue: 'KE'
    });
  }
};
