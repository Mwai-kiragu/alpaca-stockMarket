'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_users_registration_step" ADD VALUE IF NOT EXISTS 'tax_info';
    `);
  },

  async down(queryInterface, Sequelize) {
    console.log('Downgrade not supported for enum values');
  }
};
