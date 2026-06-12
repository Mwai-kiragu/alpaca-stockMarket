'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Rename columns to match Sequelize snake_case convention
    await queryInterface.renameColumn('questions', 'questionType', 'question_type');
    await queryInterface.renameColumn('questions', 'isRequired', 'is_required');
    await queryInterface.renameColumn('questions', 'isActive', 'is_active');
    await queryInterface.renameColumn('questions', 'createdAt', 'created_at');
    await queryInterface.renameColumn('questions', 'updatedAt', 'updated_at');
  },

  async down(queryInterface, Sequelize) {
    // Revert column names
    await queryInterface.renameColumn('questions', 'question_type', 'questionType');
    await queryInterface.renameColumn('questions', 'is_required', 'isRequired');
    await queryInterface.renameColumn('questions', 'is_active', 'isActive');
    await queryInterface.renameColumn('questions', 'created_at', 'createdAt');
    await queryInterface.renameColumn('questions', 'updated_at', 'updatedAt');
  }
};