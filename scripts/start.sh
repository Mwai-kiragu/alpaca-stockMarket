#!/bin/bash

echo "🚀 Starting Trading Platform Backend..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env file with your configuration values."
    exit 1
fi

# Check environment variables
echo "🔍 Checking environment variables..."
node scripts/check-env.js

if [ $? -ne 0 ]; then
    echo "❌ Environment check failed. Please fix the issues above."
    exit 1
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Check if PostgreSQL is running
echo "🔗 Checking PostgreSQL connection..."
if ! pg_isready -d "${DATABASE_URL:-postgresql://postgres:password@localhost:5432/trading_platform}" > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running or not accessible."
    echo "Please start PostgreSQL or check your DATABASE_URL."
    exit 1
fi

echo "✅ PostgreSQL connection successful"

# Setup database (create admin user if needed)
echo "🔄 Setting up database..."
node scripts/setup.js

# Start the application
echo "🎉 Starting the application..."
if [ "$NODE_ENV" = "production" ]; then
    npm start
else
    npm run dev
fi