#!/bin/bash

# Complete deployment script for trading platform backend
# Usage: ./deploy.sh

set -e  # Exit on any error

echo "🚀 Starting complete deployment of trading platform backend..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're on the server
if [ ! -f /etc/os-release ]; then
    print_error "This script should be run on the server, not locally"
    exit 1
fi

print_status "Step 1: System updates and basic packages"
apt update && apt upgrade -y
apt install -y curl wget git unzip software-properties-common

print_status "Step 2: Install Node.js 18.x"
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs
print_status "Node.js version: $(node --version)"
print_status "npm version: $(npm --version)"

print_status "Step 3: Install PM2 globally"
npm install -g pm2

print_status "Step 4: Install and configure PostgreSQL"
apt install -y postgresql postgresql-contrib

# Start PostgreSQL service
systemctl start postgresql
systemctl enable postgresql

# Configure PostgreSQL
print_status "Configuring PostgreSQL..."
sudo -u postgres psql << EOF
-- Create database
DROP DATABASE IF EXISTS trading_platform;
CREATE DATABASE trading_platform;

-- Create user
DROP USER IF EXISTS postgres;
ALTER USER postgres PASSWORD '@Mwai1234';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE trading_platform TO postgres;

-- Exit
\q
EOF

print_status "Step 5: Configure PostgreSQL for connections"
# Update postgresql.conf
PG_VERSION=$(sudo -u postgres psql -t -c "SELECT version();" | grep -oE '[0-9]+\.[0-9]+' | head -1)
PG_CONFIG_DIR="/etc/postgresql/$PG_VERSION/main"

if [ -f "$PG_CONFIG_DIR/postgresql.conf" ]; then
    sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" "$PG_CONFIG_DIR/postgresql.conf"
    sed -i "s/#port = 5432/port = 5433/" "$PG_CONFIG_DIR/postgresql.conf"
fi

# Update pg_hba.conf
if [ -f "$PG_CONFIG_DIR/pg_hba.conf" ]; then
    echo "host    all             all             0.0.0.0/0               md5" >> "$PG_CONFIG_DIR/pg_hba.conf"
fi

systemctl restart postgresql

print_status "Step 6: Setup firewall"
ufw allow OpenSSH
ufw allow 22/tcp
ufw allow 3000/tcp
ufw allow 5433/tcp
ufw --force enable

print_status "Step 7: Clone or update repository"
PROJECT_DIR="/root/trading-platform-backend"

if [ -d "$PROJECT_DIR" ]; then
    print_status "Repository exists, updating..."
    cd "$PROJECT_DIR"
    git fetch origin
    git reset --hard origin/feature/signup
    git pull origin feature/signup
else
    print_status "Cloning repository..."
    cd /root
    git clone https://github.com/Mwai-kiragu/alpaca-stockMarket.git trading-platform-backend
    cd "$PROJECT_DIR"
    git checkout feature/signup
fi

print_status "Step 8: Install dependencies"
cd "$PROJECT_DIR"
npm install --production

print_status "Step 9: Create .env file"
cat > .env << 'EOF'
# Server Configuration
PORT=3000
NODE_ENV=production

# Database PostgreSQL
DB_HOST=localhost
DB_PORT=5433
DB_NAME=trading_platform
DB_USER=postgres
DB_PASSWORD=@Mwai1234
DB_SSL=false

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-production-$(openssl rand -base64 32)
JWT_EXPIRES_IN=7d

# Alpaca API Configuration
ALPACA_API_KEY=CKCGF11DM4LDIXCZRDC1
ALPACA_SECRET_KEY=PIbFi21a5btgOafcZH1N1BIrEb5VPtKsWBRk3Upx
ALPACA_BASE_URL=https://broker-api.sandbox.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets

# MPesa Daraja API Configuration
MPESA_CONSUMER_KEY=your-mpesa-consumer-key
MPESA_CONSUMER_SECRET=your-mpesa-consumer-secret
MPESA_PASSKEY=your-mpesa-passkey
MPESA_SHORTCODE=your-mpesa-shortcode
MPESA_CALLBACK_URL=http://134.209.217.111:3000/api/v1/wallet/mpesa/callback

# Exchange Rate API
EXCHANGE_RATE_API_KEY=your-exchange-rate-api-key

# Gmail SMTP Configuration (temporarily disabled)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=onesmusmwai40@gmail.com
SMTP_PASS=fuxm ijsv rbxs izkl
SMTP_FROM=onesmusmwai40@gmail.com
SMTP_SECURE=false

# Redis Configuration (for caching and sessions)
REDIS_URL=redis://localhost:6379

# Encryption
ENCRYPTION_KEY=$(openssl rand -base64 32)
EOF

print_status "Step 10: Run database migrations"
npm run migrate || print_warning "Migrations failed - will continue anyway"

print_status "Step 11: Create PM2 ecosystem file"
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'trading-platform',
    script: './src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024'
  }]
};
EOF

print_status "Step 12: Create logs directory"
mkdir -p logs

print_status "Step 13: Start application with PM2"
pm2 delete all || true  # Delete existing processes
pm2 start ecosystem.config.js
pm2 save
pm2 startup

print_status "Step 14: Setup nginx (optional reverse proxy)"
apt install -y nginx

cat > /etc/nginx/sites-available/trading-platform << 'EOF'
server {
    listen 80;
    server_name 134.209.217.111;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/trading-platform /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

print_status "Step 15: Final status check"
echo ""
echo "=== DEPLOYMENT SUMMARY ==="
echo "📍 Server IP: 134.209.217.111"
echo "🔗 Application URL: http://134.209.217.111"
echo "🔗 API Health: http://134.209.217.111/health"
echo "🔗 Direct Node.js: http://134.209.217.111:3000"
echo ""

print_status "PostgreSQL Status:"
systemctl is-active postgresql && echo "✅ PostgreSQL is running" || echo "❌ PostgreSQL is not running"

print_status "Application Status:"
pm2 status

print_status "Testing API endpoints..."
curl -s http://localhost:3000/health && echo "✅ Health endpoint working" || echo "❌ Health endpoint failed"

echo ""
print_status "🎉 Deployment completed!"
print_status "You can now access your application at: http://134.209.217.111"
print_status ""
print_status "Useful commands:"
print_status "- Check logs: pm2 logs trading-platform"
print_status "- Restart app: pm2 restart trading-platform"
print_status "- App status: pm2 status"
print_status "- DB access: psql -h localhost -p 5433 -U postgres -d trading_platform"
EOF