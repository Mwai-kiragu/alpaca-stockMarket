#!/bin/bash

echo "🔄 Installing and setting up PostgreSQL..."

# Check if running on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew not found. Installing Homebrew first..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi

    echo "📦 Installing PostgreSQL..."
    brew install postgresql@14

    echo "🚀 Starting PostgreSQL service..."
    brew services start postgresql@14

    # Wait a moment for service to start
    sleep 3

    echo "🗃️ Creating database..."
    createdb trading_platform

    echo "✅ PostgreSQL setup completed!"
    echo ""
    echo "📝 Update your .env file with:"
    echo "DATABASE_URL=postgresql://$(whoami)@localhost:5432/trading_platform"

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo "📦 Installing PostgreSQL on Linux..."

    # Check if apt is available (Ubuntu/Debian)
    if command -v apt &> /dev/null; then
        sudo apt update
        sudo apt install -y postgresql postgresql-contrib
        sudo systemctl start postgresql
        sudo systemctl enable postgresql

        echo "🗃️ Creating database..."
        sudo -u postgres createdb trading_platform
        sudo -u postgres psql -c "CREATE USER $(whoami) WITH SUPERUSER;"

        echo "✅ PostgreSQL setup completed!"
        echo ""
        echo "📝 Update your .env file with:"
        echo "DATABASE_URL=postgresql://$(whoami)@localhost:5432/trading_platform"

    else
        echo "❌ Unsupported Linux distribution. Please install PostgreSQL manually."
        exit 1
    fi

else
    echo "❌ Unsupported operating system: $OSTYPE"
    echo "Please install PostgreSQL manually."
    exit 1
fi

echo ""
echo "🎉 Ready to run: npm start"