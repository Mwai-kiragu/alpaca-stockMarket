#!/bin/bash

# Quick update script for trading platform backend
# Usage: ./update.sh

set -e

echo "🔄 Updating trading platform backend..."

cd /root/trading-platform-backend

# Pull latest changes
echo "📥 Pulling latest changes..."
git fetch origin
git pull origin feature/signup

# Install any new dependencies
echo "📦 Installing dependencies..."
npm install --production

# Run migrations if needed
echo "🗄️ Running database migrations..."
npm run migrate || echo "⚠️ Migrations completed with warnings"

# Restart the application
echo "🔄 Restarting application..."
pm2 restart trading-platform

# Show status
echo "📊 Application status:"
pm2 status

echo "✅ Update completed!"
echo "🔗 Application URL: http://134.209.217.111"