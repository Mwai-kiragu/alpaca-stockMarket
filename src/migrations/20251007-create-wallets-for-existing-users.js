'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('Creating wallets for existing completed users...');

      // Find all users who have completed onboarding but don't have wallets
      const [users] = await queryInterface.sequelize.query(`
        SELECT u.id, u.email, u.registration_status
        FROM users u
        LEFT JOIN wallets w ON u.id = w.user_id
        WHERE u.registration_status = 'completed'
        AND w.id IS NULL
        AND u.deleted_at IS NULL;
      `);

      if (users.length === 0) {
        console.log('No completed users found without wallets');
        return;
      }

      console.log(`Found ${users.length} completed users without wallets`);

      // Create wallets for these users
      for (const user of users) {
        try {
          const walletId = require('uuid').v4();

          await queryInterface.sequelize.query(`
            INSERT INTO wallets (id, user_id, kes_balance, usd_balance, frozen_kes, frozen_usd, created_at, updated_at)
            VALUES (
              '${walletId}',
              '${user.id}',
              0.00,
              0.00,
              0.00,
              0.00,
              NOW(),
              NOW()
            );
          `);

          console.log(`Created wallet for user ${user.email} (ID: ${user.id})`);
        } catch (userError) {
          console.error(`Failed to create wallet for user ${user.id}:`, userError);
          // Continue with other users
        }
      }

      console.log('Successfully completed wallet creation for existing users');

    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Rolling back wallet creation for existing users...');

      // This rollback will remove wallets that were created by this migration
      // We'll identify them by finding wallets with zero balances created during this migration timeframe
      // Note: This is a conservative approach - we only remove empty wallets
      await queryInterface.sequelize.query(`
        DELETE FROM wallets
        WHERE kes_balance = 0.00
        AND usd_balance = 0.00
        AND frozen_kes = 0.00
        AND frozen_usd = 0.00
        AND created_at >= (NOW() - INTERVAL '1 hour');
      `);

      console.log('Successfully rolled back wallet creation');

    } catch (error) {
      console.error('Rollback error:', error);
      throw error;
    }
  }
};