'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE users
      SET account_mode = 'real'
      WHERE account_mode = 'demo'
        AND (alpaca_account_id IS NOT NULL OR mystocks_sub_account_id IS NOT NULL OR created_at < NOW())
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      UPDATE users SET account_mode = 'demo' WHERE account_mode = 'real'
    `);
  }
};
