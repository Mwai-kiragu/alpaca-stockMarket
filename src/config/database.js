const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

const sequelize = process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('#')
  ? new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ?
      (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  })
  : new Sequelize(
  process.env.DB_NAME || 'trading_platform',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5433,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ?
      (msg) => logger.debug(msg) : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      freezeTableName: true,
    },
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    logger.info(`PostgreSQL Connected: ${sequelize.config.host}:${sequelize.config.port}`);

    if (process.env.NODE_ENV !== 'production') {
      await sequelize.sync({ alter: false }); // Changed from alter: true to prevent schema changes
      logger.info('Database synchronized');
    }
  } catch (error) {
    logger.error('Database connection failed:', error.message);
    logger.info('💡 To fix this:');
    logger.info('1. Install PostgreSQL: brew install postgresql');
    logger.info('2. Start PostgreSQL: brew services start postgresql');
    logger.info('3. Create database: createdb trading_platform');
    logger.info('4. Update .env with correct DATABASE_URL');
    // Don't exit the process - just log the error and continue
    logger.warn('Server will continue running without database connection');
  }
};

sequelize.addHook('beforeConnect', (config) => {
  logger.info('Attempting to connect to PostgreSQL...');
});

sequelize.addHook('afterConnect', (connection, config) => {
  logger.info('Successfully connected to PostgreSQL');
});

sequelize.addHook('beforeDisconnect', (connection) => {
  logger.info('Disconnecting from PostgreSQL...');
});

process.on('SIGINT', async () => {
  logger.info('Closing PostgreSQL connection...');
  await sequelize.close();
  process.exit(0);
});

module.exports = { sequelize, connectDB };