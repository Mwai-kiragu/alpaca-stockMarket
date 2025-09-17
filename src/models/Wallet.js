const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Transaction extends Model {}

class Wallet extends Model {
  get availableKes() {
    return this.kes_balance - this.frozen_kes;
  }

  get availableUsd() {
    return this.usd_balance - this.frozen_usd;
  }

  async addTransaction(transactionData) {
    const transaction = await Transaction.create({
      ...transactionData,
      wallet_id: this.id,
      reference: transactionData.reference || `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    });

    return transaction;
  }

  async freezeFunds(amount, currency) {
    if (currency === 'KES') {
      if (this.availableKes < amount) {
        throw new Error('Insufficient KES balance');
      }
      this.frozen_kes += amount;
    } else if (currency === 'USD') {
      if (this.availableUsd < amount) {
        throw new Error('Insufficient USD balance');
      }
      this.frozen_usd += amount;
    }
    return this.save();
  }

  async unfreezeFunds(amount, currency) {
    if (currency === 'KES') {
      this.frozen_kes = Math.max(0, this.frozen_kes - amount);
    } else if (currency === 'USD') {
      this.frozen_usd = Math.max(0, this.frozen_usd - amount);
    }
    return this.save();
  }

  async updateBalance(amount, currency, operation = 'add') {
    if (currency === 'KES') {
      if (operation === 'add') {
        this.kes_balance += amount;
      } else {
        this.kes_balance = Math.max(0, this.kes_balance - amount);
      }
    } else if (currency === 'USD') {
      if (operation === 'add') {
        this.usd_balance += amount;
      } else {
        this.usd_balance = Math.max(0, this.usd_balance - amount);
      }
    }
    return this.save();
  }
}

Transaction.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  wallet_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'wallets',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('deposit', 'withdrawal', 'trade_buy', 'trade_sell', 'fee', 'forex_conversion'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  currency: {
    type: DataTypes.ENUM('KES', 'USD'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'completed', 'failed', 'cancelled'),
    defaultValue: 'pending'
  },
  reference: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: false
  },
  mpesa_transaction_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  alpaca_order_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  exchange_rate: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  fees: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  sequelize,
  modelName: 'Transaction',
  tableName: 'transactions',
  indexes: [
    {
      fields: ['wallet_id']
    },
    {
      fields: ['reference'],
      unique: true
    },
    {
      fields: ['mpesa_transaction_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    }
  ]
});

Wallet.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  kes_balance: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  usd_balance: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  frozen_kes: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  frozen_usd: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
    validate: {
      min: 0
    }
  }
}, {
  sequelize,
  modelName: 'Wallet',
  tableName: 'wallets',
  indexes: [
    {
      fields: ['user_id'],
      unique: true
    }
  ]
});

// Associations
Wallet.hasMany(Transaction, { foreignKey: 'wallet_id', as: 'transactions' });
Transaction.belongsTo(Wallet, { foreignKey: 'wallet_id', as: 'wallet' });

module.exports = { Wallet, Transaction };