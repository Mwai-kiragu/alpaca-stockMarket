'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('wallets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      kes_balance: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      usd_balance: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      frozen_kes: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      frozen_usd: { type: Sequelize.DECIMAL(15, 2), defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex('wallets', ['user_id'], { unique: true });

    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_transactions_type" AS ENUM ('deposit','withdrawal','trade_buy','trade_sell','fee','forex_conversion');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE TYPE "enum_transactions_currency" AS ENUM ('KES','USD');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN
        CREATE TYPE "enum_transactions_status" AS ENUM ('pending','completed','failed','cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryInterface.createTable('transactions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      type: { type: Sequelize.ENUM('deposit','withdrawal','trade_buy','trade_sell','fee','forex_conversion'), allowNull: false },
      amount: { type: Sequelize.DECIMAL(15, 2), allowNull: false },
      currency: { type: Sequelize.ENUM('KES','USD'), allowNull: false },
      status: { type: Sequelize.ENUM('pending','completed','failed','cancelled'), defaultValue: 'pending' },
      reference: { type: Sequelize.STRING(100), unique: true, allowNull: false },
      mpesa_transaction_id: { type: Sequelize.STRING(100), allowNull: true },
      alpaca_order_id: { type: Sequelize.STRING(100), allowNull: true },
      exchange_rate: { type: Sequelize.DECIMAL(10, 6), allowNull: true },
      fees: { type: Sequelize.JSONB, defaultValue: {} },
      description: { type: Sequelize.TEXT, allowNull: true },
      metadata: { type: Sequelize.JSONB, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex('transactions', ['wallet_id']);
    await queryInterface.addIndex('transactions', ['reference'], { unique: true });
    await queryInterface.addIndex('transactions', ['mpesa_transaction_id']);
    await queryInterface.addIndex('transactions', ['status']);
    await queryInterface.addIndex('transactions', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('transactions');
    await queryInterface.dropTable('wallets');
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_transactions_type";
      DROP TYPE IF EXISTS "enum_transactions_currency";
      DROP TYPE IF EXISTS "enum_transactions_status";
    `);
  }
};
