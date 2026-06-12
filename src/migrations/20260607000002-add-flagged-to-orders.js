'use strict';

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS flag_note TEXT;
      ALTER TABLE ms_orders
        ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS flag_note TEXT;
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('orders', 'flagged');
    await queryInterface.removeColumn('orders', 'flag_note');
    await queryInterface.removeColumn('ms_orders', 'flagged');
    await queryInterface.removeColumn('ms_orders', 'flag_note');
  }
};
