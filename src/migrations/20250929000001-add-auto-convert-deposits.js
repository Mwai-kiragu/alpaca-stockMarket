'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add auto_convert_deposits column if it doesn't exist
    const tableDescription = await queryInterface.describeTable('users');

    if (!tableDescription.auto_convert_deposits) {
      await queryInterface.addColumn('users', 'auto_convert_deposits', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        comment: 'Automatically convert KES deposits to USD using real-time exchange rates'
      });
    }

    // Update existing users to have auto-conversion enabled by default
    await queryInterface.sequelize.query(`
      UPDATE users
      SET auto_convert_deposits = true
      WHERE auto_convert_deposits IS NULL OR auto_convert_deposits = false
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'auto_convert_deposits');
  }
};