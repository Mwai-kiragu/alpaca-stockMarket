'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_enabled BOOLEAN NOT NULL DEFAULT false;`);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'pin_enabled');
  }
};
