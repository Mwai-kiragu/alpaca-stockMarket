'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('platform_revenue', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('trade_fee', 'deposit_fee', 'withdrawal_fee', 'forex_fee'),
        allowNull: false,
      },
      amount_usd: {
        type: Sequelize.DECIMAL(18, 8),
        allowNull: true,
      },
      amount_kes: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true,
      },
      currency: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'USD',
      },
      reference: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('platform_revenue', ['user_id']);
    await queryInterface.addIndex('platform_revenue', ['type']);
    await queryInterface.addIndex('platform_revenue', ['created_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('platform_revenue');
  },
};
