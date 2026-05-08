'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add is_active column if it doesn't exist
    const tableInfo = await queryInterface.describeTable('users');

    if (!tableInfo.is_active) {
      await queryInterface.addColumn('users', 'is_active', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

    // Add deleted_at column if it doesn't exist
    if (!tableInfo.deleted_at) {
      await queryInterface.addColumn('users', 'deleted_at', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null
      });
    }

    // Add index on deleted_at for performance
    await queryInterface.addIndex('users', ['deleted_at'], {
      name: 'users_deleted_at_index'
    });

    // Add composite index for active users
    await queryInterface.addIndex('users', ['is_active', 'deleted_at'], {
      name: 'users_soft_delete_index'
    });
  },

  async down (queryInterface, Sequelize) {
    // Remove indexes
    await queryInterface.removeIndex('users', 'users_soft_delete_index');
    await queryInterface.removeIndex('users', 'users_deleted_at_index');

    // Remove columns
    await queryInterface.removeColumn('users', 'deleted_at');
    await queryInterface.removeColumn('users', 'is_active');
  }
};
