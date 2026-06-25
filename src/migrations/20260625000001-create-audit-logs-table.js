'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('audit_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      actor_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      actor_role: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'system',
      },
      action: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      target_type: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      target_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      details: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      ip: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('success', 'failure'),
        allowNull: false,
        defaultValue: 'success',
      },
      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'error'),
        allowNull: false,
        defaultValue: 'info',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex('audit_logs', ['actor_id']);
    await queryInterface.addIndex('audit_logs', ['action']);
    await queryInterface.addIndex('audit_logs', ['target_type', 'target_id']);
    await queryInterface.addIndex('audit_logs', ['severity']);
    await queryInterface.addIndex('audit_logs', ['status']);
    await queryInterface.addIndex('audit_logs', ['created_at']);
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('audit_logs');
  },
};
