'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('watchlists', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      alpaca_watchlist_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: 'Watchlist ID from Alpaca API'
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      symbols: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW
      }
    });

    // Add unique index on user_id (one watchlist per user)
    await queryInterface.addIndex('watchlists', ['user_id'], { unique: true });

    // Add index on alpaca_watchlist_id for faster lookups
    await queryInterface.addIndex('watchlists', ['alpaca_watchlist_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('watchlists');
  }
};
