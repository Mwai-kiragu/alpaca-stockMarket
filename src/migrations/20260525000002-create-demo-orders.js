'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS demo_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        symbol VARCHAR(30) NOT NULL,
        side VARCHAR(10) NOT NULL,
        quantity DECIMAL(15,6) NOT NULL,
        price_usd DECIMAL(15,8),
        gross_usd DECIMAL(15,8),
        fee_usd DECIMAL(15,8),
        total_cost_usd DECIMAL(15,8),
        currency VARCHAR(10) DEFAULT 'USD',
        exchange VARCHAR(20),
        balance_after DECIMAL(15,2),
        status VARCHAR(30) DEFAULT 'FILLED',
        filled_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS demo_orders_user_id ON demo_orders(user_id);
      CREATE INDEX IF NOT EXISTS demo_orders_user_symbol ON demo_orders(user_id, symbol);
    `);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('demo_orders');
  }
};
