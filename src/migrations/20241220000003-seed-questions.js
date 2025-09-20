'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.bulkInsert('questions', [
      {
        id: 1,
        question: 'What is your primary source of income?',
        questionType: 'multiple_choice',
        options: JSON.stringify([
          { "value": "employment", "label": "Employment" },
          { "value": "business", "label": "Business" },
          { "value": "investment", "label": "Investment" },
          { "value": "other", "label": "Other" }
        ]),
        category: 'financial_assessment',
        isRequired: true,
        order: 1,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 2,
        question: 'What is your annual income range?',
        questionType: 'multiple_choice',
        options: JSON.stringify([
          { "value": "under_50k", "label": "Under $50,000" },
          { "value": "50k_100k", "label": "$50,000 - $100,000" },
          { "value": "100k_250k", "label": "$100,000 - $250,000" },
          { "value": "over_250k", "label": "Over $250,000" }
        ]),
        category: 'financial_assessment',
        isRequired: true,
        order: 2,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 3,
        question: 'What is your primary purpose for this account?',
        questionType: 'multiple_choice',
        options: JSON.stringify([
          { "value": "saving", "label": "Saving" },
          { "value": "investment", "label": "Investment" },
          { "value": "business", "label": "Business" },
          { "value": "daily_transactions", "label": "Daily Transactions" }
        ]),
        category: 'financial_assessment',
        isRequired: true,
        order: 3,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 4,
        question: 'What is your risk tolerance for investments?',
        questionType: 'multiple_choice',
        options: JSON.stringify([
          { "value": "low", "label": "Low - I prefer stable returns with minimal risk" },
          { "value": "moderate", "label": "Moderate - I can accept some risk for potentially higher returns" },
          { "value": "high", "label": "High - I'm comfortable with significant risk for potential high returns" }
        ]),
        category: 'financial_assessment',
        isRequired: true,
        order: 4,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 5,
        question: 'Do you have experience with financial products and investing?',
        questionType: 'multiple_choice',
        options: JSON.stringify([
          { "value": "none", "label": "No experience" },
          { "value": "basic", "label": "Basic experience with savings accounts and simple investments" },
          { "value": "intermediate", "label": "Intermediate experience with stocks, bonds, and mutual funds" },
          { "value": "advanced", "label": "Advanced experience with complex financial instruments" }
        ]),
        category: 'financial_assessment',
        isRequired: true,
        order: 5,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('questions', null, {});
  }
};