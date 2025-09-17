# Trading Platform Backend

A comprehensive Node.js backend service for a trading platform with Alpaca API integration, MPesa payments, and multi-currency wallet support.

## Features

- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Multi-Currency Wallets**: Support for KES and USD wallets with automatic forex conversion
- **MPesa Integration**: Seamless deposits via Safaricom's Daraja API
- **Trading**: Real-time stock trading via Alpaca Trading API
- **Market Data**: Live stock prices, charts, and market information
- **Portfolio Management**: Real-time portfolio tracking and analysis
- **KYC Verification**: Complete know-your-customer workflow
- **Notifications**: Push, email, and SMS notifications
- **Customer Support**: Integrated ticketing system
- **Admin Panel**: User management and system monitoring

## Architecture

```
src/
├── config/          # Database and configuration
├── controllers/     # Request handlers
├── middleware/      # Authentication, validation, error handling
├── models/          # Mongoose/database models
├── routes/          # API route definitions
├── services/        # External service integrations
├── utils/           # Helper functions and utilities
└── server.js        # Application entry point
```

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: PostgreSQL with Sequelize ORM
- **Authentication**: JSON Web Tokens (JWT)
- **Real-time**: Socket.io for live updates
- **External APIs**:
  - Alpaca Trading API (US stock trading)
  - Safaricom Daraja API (MPesa payments)
  - Exchange Rate API (currency conversion)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd trading-platform-backend
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start MongoDB service

5. Run the application:
```bash
# Development
npm run dev

# Production
npm start
```

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/trading-platform

# JWT
JWT_SECRET=your-super-secure-jwt-secret-key
JWT_EXPIRES_IN=7d

# Alpaca API (use paper trading for testing)
ALPACA_API_KEY=your-alpaca-api-key
ALPACA_SECRET_KEY=your-alpaca-secret-key
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets

# MPesa Daraja API
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret
MPESA_PASSKEY=your-mpesa-passkey
MPESA_SHORTCODE=your-mpesa-shortcode
MPESA_CALLBACK_URL=https://yourdomain.com/api/payments/mpesa/callback

# Exchange Rate
EXCHANGE_RATE_API_KEY=your-exchange-rate-api-key
```

## API Documentation

### Authentication Endpoints

#### Register User
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+254700000000",
  "password": "StrongPassword123"
}
```

#### Login
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "StrongPassword123"
}
```

#### Get User Profile
```http
GET /api/v1/auth/me
Authorization: Bearer <token>
```

### Wallet Endpoints

#### Get Wallet Information
```http
GET /api/v1/wallet
Authorization: Bearer <token>
```

#### Initiate MPesa Deposit
```http
POST /api/v1/wallet/deposit
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 1000,
  "phone": "254700000000"
}
```

#### Convert Currency
```http
POST /api/v1/wallet/convert
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 1000,
  "fromCurrency": "KES",
  "toCurrency": "USD"
}
```

### Trading Endpoints

#### Place Order
```http
POST /api/v1/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "symbol": "AAPL",
  "side": "buy",
  "orderType": "market",
  "quantity": 10,
  "currency": "USD"
}
```

#### Get Orders
```http
GET /api/v1/orders?page=1&limit=20&status=filled
Authorization: Bearer <token>
```

### Market Data Endpoints

#### Get Stock Quote
```http
GET /api/v1/stocks/quote/AAPL
Authorization: Bearer <token>
```

#### Get Price History
```http
GET /api/v1/stocks/bars/AAPL?timeframe=1Day&limit=100
Authorization: Bearer <token>
```

#### Search Stocks
```http
GET /api/v1/search?q=apple&type=stocks
Authorization: Bearer <token>
```

## User Flow

### 1. Registration & Authentication
- User registers with email, phone, and password
- JWT token issued for subsequent requests
- Automatic wallet creation (KES and USD)

### 2. KYC Verification
- User submits identity documents
- Admin reviews and approves/rejects
- Required for trading functionality

### 3. Funding Wallet
- User initiates MPesa deposit
- STK push sent to user's phone
- Funds credited to KES wallet upon confirmation

### 4. Currency Conversion
- Optional conversion from KES to USD
- Real-time exchange rates applied
- Forex fees calculated and deducted

### 5. Trading
- User places buy/sell orders
- Orders routed to Alpaca for execution
- Real-time order status updates via WebSocket

### 6. Portfolio Management
- Real-time portfolio value updates
- Position tracking and P&L calculation
- Transaction history and reporting

## Security Features

- **Rate Limiting**: API rate limiting to prevent abuse
- **Input Validation**: Comprehensive request validation
- **SQL Injection Protection**: Mongoose ODM provides protection
- **XSS Protection**: Helmet.js security headers
- **Authentication**: JWT with secure secret rotation
- **Account Lockout**: Automatic lockout after failed login attempts
- **Audit Logging**: Comprehensive activity logging

## Error Handling

The API uses standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

Error Response Format:
```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "email",
      "message": "Valid email is required"
    }
  ]
}
```

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- --grep "Auth"
```

## Deployment

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis (for caching)
- SSL Certificate (for production)

### Production Setup

1. **Environment Configuration**:
   - Set `NODE_ENV=production`
   - Use strong JWT secrets
   - Configure proper database connections
   - Set up monitoring and logging

2. **Security Checklist**:
   - Enable HTTPS
   - Configure CORS properly
   - Set up rate limiting
   - Enable audit logging
   - Regular security updates

3. **Monitoring**:
   - Set up application monitoring
   - Configure error tracking
   - Database performance monitoring
   - API response time tracking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions:
- Create an issue in the repository
- Contact support team at support@example.com

## Changelog

### v1.0.0
- Initial release
- Authentication and user management
- Wallet and MPesa integration
- Trading functionality via Alpaca
- Portfolio management
- Customer support system