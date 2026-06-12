'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('biometric_auths', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      device_id: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      device_name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      device_model: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      os_version: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      biometric_type: {
        type: Sequelize.ENUM('fingerprint', 'face', 'voice', 'iris'),
        allowNull: false
      },
      public_key: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      biometric_template_hash: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      challenge_token: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      token_expires_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      verification_attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false
      },
      max_attempts: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      registered_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
        allowNull: false
      },
      disabled_at: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Add indexes
    await queryInterface.addIndex('biometric_auths', ['user_id']);
    await queryInterface.addIndex('biometric_auths', ['device_id']);
    await queryInterface.addIndex('biometric_auths', ['user_id', 'device_id'], { unique: true });
    await queryInterface.addIndex('biometric_auths', ['challenge_token'], {
      unique: true,
      where: {
        challenge_token: { [Sequelize.Op.ne]: null }
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('biometric_auths');
  }
};