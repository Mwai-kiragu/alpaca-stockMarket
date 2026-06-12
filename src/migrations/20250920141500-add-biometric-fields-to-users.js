'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_enabled BOOLEAN NOT NULL DEFAULT false;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255);`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS security_preferences JSONB NOT NULL DEFAULT '{"require_biometric_for_login":false,"require_biometric_for_transactions":true,"biometric_timeout_minutes":15}';`);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'biometric_enabled');
    await queryInterface.removeColumn('users', 'two_factor_enabled');
    await queryInterface.removeColumn('users', 'pin_hash');
    await queryInterface.removeColumn('users', 'security_preferences');
  }
};
