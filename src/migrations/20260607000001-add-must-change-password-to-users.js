'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('users', 'must_change_password');
  }
};
