const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Post extends Model {}

Post.init({
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  type: {
    type: DataTypes.ENUM('news', 'blog', 'learn'),
    allowNull: false,
  },
  title: { type: DataTypes.STRING(500), allowNull: false },
  slug: { type: DataTypes.STRING(500), allowNull: false, unique: true },
  excerpt: { type: DataTypes.TEXT, allowNull: true },
  content: { type: DataTypes.TEXT, allowNull: true },
  cover_image_url: { type: DataTypes.STRING(1000), allowNull: true },
  author: { type: DataTypes.STRING(200), defaultValue: 'Riven Team' },
  category: { type: DataTypes.STRING(100), allowNull: true },
  read_time: { type: DataTypes.INTEGER, allowNull: true },
  tags: { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
  status: {
    type: DataTypes.ENUM('draft', 'published'),
    defaultValue: 'draft',
  },
  published_at: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize,
  modelName: 'Post',
  tableName: 'posts',
  indexes: [
    { fields: ['type'] },
    { fields: ['slug'] },
    { fields: ['status'] },
    { fields: ['published_at'] },
  ],
});

module.exports = Post;
