const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class StaticPage extends Model {}

StaticPage.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  slug: {
    type: DataTypes.STRING(200),
    allowNull: false,
    unique: true,
    validate: { notEmpty: true },
  },
  content: { type: DataTypes.TEXT, allowNull: true },
}, {
  sequelize,
  modelName: 'StaticPage',
  tableName: 'static_pages',
  indexes: [{ fields: ['slug'] }],
});

module.exports = StaticPage;
