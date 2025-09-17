# PostgreSQL Setup Guide

## Quick Setup

### Option 1: Automated Setup (Recommended)
```bash
# Run the installation script
./scripts/install-postgres.sh

# Copy environment file
cp .env.example .env

# Start the application
npm start
```

### Option 2: Manual Setup

#### macOS (using Homebrew)
```bash
# Install PostgreSQL
brew install postgresql@14

# Start PostgreSQL service
brew services start postgresql@14

# Create database
createdb trading_platform

# Update .env file
echo "DATABASE_URL=postgresql://$(whoami)@localhost:5432/trading_platform" >> .env
```

#### Ubuntu/Debian
```bash
# Install PostgreSQL
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres createdb trading_platform
sudo -u postgres createuser $(whoami) --superuser

# Update .env file
echo "DATABASE_URL=postgresql://$(whoami)@localhost:5432/trading_platform" >> .env
```

#### Windows
```bash
# Download and install PostgreSQL from https://www.postgresql.org/download/windows/
# Create database using pgAdmin or command line
createdb trading_platform

# Update .env file
echo "DATABASE_URL=postgresql://postgres:password@localhost:5432/trading_platform" >> .env
```

## Environment Configuration

Create `.env` file with your database connection:

```env
# Database
DATABASE_URL=postgresql://username@localhost:5432/trading_platform

# Other required variables
JWT_SECRET=your-super-secure-jwt-secret-key
ALPACA_API_KEY=your-alpaca-api-key
ALPACA_SECRET_KEY=your-alpaca-secret-key
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret
MPESA_PASSKEY=your-mpesa-passkey
MPESA_SHORTCODE=your-mpesa-shortcode
```

## Database Features

### Sequelize ORM
- **Models**: User, Wallet, Transaction, Order, Notification, SupportTicket
- **Associations**: Proper foreign key relationships
- **Migrations**: Database schema versioning
- **Auto-sync**: Development mode automatic table creation

### PostgreSQL Advantages
- **JSONB Support**: For flexible metadata and settings
- **UUID Primary Keys**: Better for distributed systems
- **ACID Transactions**: Data integrity guarantees
- **Performance**: Optimized queries with proper indexing
- **Scalability**: Better horizontal and vertical scaling

## Common Commands

```bash
# Database operations
npm run db:create     # Create database
npm run migrate       # Run migrations
npm run migrate:undo  # Rollback migration
npm run seed          # Run seeders

# Development
npm run dev           # Start development server
npm start            # Start production server
npm test             # Run tests
```

## Troubleshooting

### Connection Issues
```bash
# Check if PostgreSQL is running
pg_isready

# Check database exists
psql -l | grep trading_platform

# Test connection
psql -d trading_platform -c "SELECT version();"
```

### Permission Issues
```bash
# Grant permissions to current user
sudo -u postgres psql -c "ALTER USER $(whoami) CREATEDB;"
```

### Reset Database
```bash
# Drop and recreate database
dropdb trading_platform
createdb trading_platform
npm run migrate
```

## Production Considerations

### Connection Pooling
The application uses Sequelize's built-in connection pooling:
- Max connections: 20
- Min connections: 0
- Acquire timeout: 60s
- Idle timeout: 10s

### SSL Configuration
For production, enable SSL:
```env
DB_SSL=true
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

### Backup Strategy
```bash
# Create backup
pg_dump trading_platform > backup.sql

# Restore backup
psql trading_platform < backup.sql
```

## Migration Guide from MongoDB

If you're migrating from MongoDB:

1. **Export MongoDB data** using `mongoexport`
2. **Transform data structure** to match PostgreSQL schema
3. **Import using Sequelize seeders** or direct SQL
4. **Update application code** to use Sequelize queries
5. **Test thoroughly** before production deployment

The models have been designed to maintain similar functionality while leveraging PostgreSQL's relational features.