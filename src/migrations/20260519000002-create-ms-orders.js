'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS ms_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id varchar(100),
        symbol varchar(30) NOT NULL,
        side varchar(10) NOT NULL,
        quantity decimal(15,6) NOT NULL DEFAULT 0,
        local_price decimal(15,6),
        usd_price decimal(15,8),
        gross_usd decimal(15,8),
        fee_usd decimal(15,8),
        total_cost_usd decimal(15,8),
        currency varchar(10) DEFAULT 'KES',
        status varchar(30) DEFAULT 'FILLED',
        exchange varchar(20),
        wallet_balance_after decimal(18,8),
        filled_at timestamptz DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS "ms_orders_user_id" ON ms_orders (user_id)`);
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS "ms_orders_user_id_symbol" ON ms_orders (user_id, symbol)`);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ms_orders');
  }
};
