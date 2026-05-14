'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('email_verification_tokens')) {
      await queryInterface.createTable('email_verification_tokens', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true,
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        token: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true
        },
        verification_code: {
          type: Sequelize.STRING(10),
          allowNull: true
        },
        expires_at: {
          type: Sequelize.DATE,
          allowNull: false
        },
        used: {
          type: Sequelize.BOOLEAN,
          defaultValue: false
        },
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false }
      });
    } else {
      // Table exists — ensure verification_code column is present (added in v2 flow)
      const cols = await queryInterface.describeTable('email_verification_tokens');
      if (!cols.verification_code) {
        await queryInterface.addColumn('email_verification_tokens', 'verification_code', {
          type: Sequelize.STRING(10),
          allowNull: true
        });
      }
    }

    const addIdx = async (table, fields, opts = {}) => {
      try { await queryInterface.addIndex(table, fields, opts); } catch (e) {
        if (!e.message.includes('already exists')) throw e;
      }
    };
    await addIdx('email_verification_tokens', ['user_id']);
    await addIdx('email_verification_tokens', ['token'], { unique: true });
    await addIdx('email_verification_tokens', ['expires_at']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('email_verification_tokens');
  }
};
