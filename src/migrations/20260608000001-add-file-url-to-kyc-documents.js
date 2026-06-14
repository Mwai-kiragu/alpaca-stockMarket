'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS file_url VARCHAR(1024)
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('kyc_documents', 'file_url');
  }
};
