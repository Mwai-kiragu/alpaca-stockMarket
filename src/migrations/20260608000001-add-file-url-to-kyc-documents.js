'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('kyc_documents', 'file_url', {
      type: Sequelize.STRING(1024),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('kyc_documents', 'file_url');
  }
};
