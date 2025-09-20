const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Question = sequelize.define('Question', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  question: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  question_type: {
    type: DataTypes.ENUM('multiple_choice', 'text', 'boolean'),
    allowNull: false,
    defaultValue: 'multiple_choice'
  },
  options: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Array of options for multiple choice questions'
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'financial_assessment'
  },
  is_required: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  order: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'questions',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['category', 'order']
    },
    {
      fields: ['is_active']
    }
  ]
});

module.exports = Question;