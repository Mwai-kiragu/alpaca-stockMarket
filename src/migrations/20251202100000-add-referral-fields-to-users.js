'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add referral_code column
    await queryInterface.addColumn('users', 'referral_code', {
      type: Sequelize.STRING(20),
      unique: true,
      allowNull: true
    });

    // Add referred_by column
    await queryInterface.addColumn('users', 'referred_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // Add referrals_count column
    await queryInterface.addColumn('users', 'referrals_count', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });

    // Add indexes
    await queryInterface.addIndex('users', ['referral_code'], {
      unique: true,
      where: { referral_code: { [Sequelize.Op.ne]: null } }
    });
    await queryInterface.addIndex('users', ['referred_by']);
    await queryInterface.addIndex('users', ['referrals_count']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'referral_code');
    await queryInterface.removeColumn('users', 'referred_by');
    await queryInterface.removeColumn('users', 'referrals_count');
  }
};
