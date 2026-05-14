'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS verification_code VARCHAR(10);
    `);

    const tables = await queryInterface.showAllTables();
    if (!tables.includes('phone_verification_tokens')) {
      await queryInterface.createTable('phone_verification_tokens', {
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
        verification_code: { type: Sequelize.STRING(10), allowNull: false },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        used: { type: Sequelize.BOOLEAN, defaultValue: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });

      await queryInterface.addIndex('phone_verification_tokens', ['user_id']);
      await queryInterface.addIndex('phone_verification_tokens', ['verification_code']);
      await queryInterface.addIndex('phone_verification_tokens', ['expires_at']);
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('email_verification_tokens', 'verification_code');
    await queryInterface.dropTable('phone_verification_tokens');
  }
};
