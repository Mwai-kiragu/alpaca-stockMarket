# Trading Platform Backend - Installation Guide

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Git

### 1. Clone and Setup

```bash
cd /Users/onesmus
git init trading-platform-backend
cd trading-platform-backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your API keys and configuration:

```env
# Required Variables
DATABASE_URL=postgresql://postgres:password@localhost:5432/trading_platform
JWT_SECRET=your-super-secure-jwt-secret-key
ALPACA_API_KEY=your-alpaca-api-key
ALPACA_SECRET_KEY=your-alpaca-secret-key
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret
MPESA_PASSKEY=your-mpesa-passkey
MPESA_SHORTCODE=your-mpesa-shortcode
```

### 3. Start the Application

```bash
# Using the start script (recommended)
./scripts/start.sh

# OR manually
npm run dev
```

## Getting API Keys

### Alpaca Trading API
1. Visit [Alpaca Markets](https://alpaca.markets/)
2. Create account and get API keys
3. Use paper trading for testing: `https://paper-api.alpaca.markets`

### MPesa Daraja API
1. Visit [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
2. Create app and get credentials
3. Use sandbox environment for testing

### Exchange Rate API
1. Visit [ExchangeRate-API](https://exchangerate-api.com/)
2. Get free API key (optional, has fallback rates)

## Project Structure

```
trading-platform-backend/
├── src/
│   ├── config/          # Database configuration
│   ├── controllers/     # Request handlers
│   ├── middleware/      # Auth, validation, error handling
│   ├── models/          # Database models
│   ├── routes/          # API routes
│   ├── services/        # External service integrations
│   ├── utils/           # Helper functions
│   └── server.js        # Application entry point
├── scripts/             # Setup and utility scripts
├── logs/               # Application logs
├── package.json        # Dependencies and scripts
├── .env.example        # Environment template
└── README.md           # Documentation
```

## Available Scripts

```bash
npm start          # Production server
npm run dev        # Development server with hot reload
npm test           # Run tests
npm run lint       # Run ESLint
./scripts/start.sh # Complete startup with checks
```

## Default Admin Account

After first run, an admin account is created:
- Email: `admin@tradingplatform.com`
- Password: `admin123`

**⚠️ Change this password immediately in production!**

## Health Check

Visit `http://localhost:3000/health` to verify the server is running.

## API Testing

Use the provided API endpoints:

```bash
# Register new user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+254700000000",
    "password": "StrongPassword123"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "StrongPassword123"
  }'
```

## Docker Deployment (Optional)

```bash
# Build and run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f app
```

## Troubleshooting

### PostgreSQL Connection Issues
- Ensure PostgreSQL is running: `pg_isready`
- Check connection string in `.env`
- Create database: `createdb trading_platform`
- For Docker: `docker-compose up postgres`

### Port Already in Use
- Change `PORT` in `.env` file
- Kill process: `lsof -ti:3000 | xargs kill`

### Missing Dependencies
```bash
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

1. **Complete the implementation** of remaining endpoints
2. **Add real Alpaca account creation** in production
3. **Implement proper KYC workflow** with document upload
4. **Add comprehensive testing**
5. **Set up monitoring and logging**

## Support

For issues and questions:
- Check the logs in `logs/` directory
- Review environment variables with `node scripts/check-env.js`
- Ensure all required services are running

Ready to build your trading platform! 🚀