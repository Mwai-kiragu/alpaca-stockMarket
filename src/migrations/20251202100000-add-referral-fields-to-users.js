'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20);`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;`);
    await queryInterface.sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrals_count INTEGER DEFAULT 0;`);

    // Add indexes only if they don't exist
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique
        ON users (referral_code) WHERE referral_code IS NOT NULL;
    `);
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS users_referred_by ON users (referred_by);`);
    await queryInterface.sequelize.query(`CREATE INDEX IF NOT EXISTS users_referrals_count ON users (referrals_count);`);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'referral_code');
    await queryInterface.removeColumn('users', 'referred_by');
    await queryInterface.removeColumn('users', 'referrals_count');
  }
};
