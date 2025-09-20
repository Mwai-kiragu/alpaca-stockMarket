'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('questions', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      question: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      questionType: {
        type: Sequelize.ENUM('multiple_choice', 'text', 'boolean'),
        allowNull: false,
        defaultValue: 'multiple_choice'
      },
      options: {
        type: Sequelize.JSON,
        allowNull: true
      },
      category: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'financial_assessment'
      },
      isRequired: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('questions', ['category', 'order']);
    await queryInterface.addIndex('questions', ['isActive']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('questions');
  }
};