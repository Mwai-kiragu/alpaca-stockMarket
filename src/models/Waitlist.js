const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Waitlist extends Model {}

Waitlist.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
      notEmpty: true,
    },
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: 'web',
  },
}, {
  sequelize,
  modelName: 'Waitlist',
  tableName: 'waitlist',
  indexes: [{ fields: ['email'] }, { fields: ['created_at'] }],
});

module.exports = Waitlist;
