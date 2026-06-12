'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Check if the column already exists
    const tableInfo = await queryInterface.describeTable('users');

    if (!tableInfo.is_onboarding_complete) {
      await queryInterface.addColumn('users', 'is_onboarding_complete', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'is_onboarding_complete');
  }
};
