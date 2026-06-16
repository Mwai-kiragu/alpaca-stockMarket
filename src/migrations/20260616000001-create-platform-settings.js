'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('platform_settings', {
      key: {
        type: Sequelize.STRING(100),
        primaryKey: true,
        allowNull: false,
      },
      value: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      updated_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.bulkInsert('platform_settings', [
      { key: 'trade_fee_rate',      value: '0.015', description: 'Fee on buy/sell orders (0.015 = 1.5%)',  updated_at: new Date() },
      { key: 'deposit_fee_rate',    value: '0.015', description: 'Fee on deposits (0.015 = 1.5%)',         updated_at: new Date() },
      { key: 'withdrawal_fee_rate', value: '0.015', description: 'Fee on withdrawals (0.015 = 1.5%)',      updated_at: new Date() },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('platform_settings');
  },
};
