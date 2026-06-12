'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('watchlists', 'alpaca_watchlist_id', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert: set a placeholder so existing nulls don't violate the constraint
    await queryInterface.sequelize.query(
      `UPDATE watchlists SET alpaca_watchlist_id = 'legacy-' || id WHERE alpaca_watchlist_id IS NULL`
    );
    await queryInterface.changeColumn('watchlists', 'alpaca_watchlist_id', {
      type: Sequelize.STRING,
      allowNull: false
    });
  }
};
