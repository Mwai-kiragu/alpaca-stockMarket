const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Order extends Model {
  get remainingQuantity() {
    return this.quantity - this.filled_quantity;
  }

  get isCompleted() {
    return ['filled', 'canceled', 'expired', 'rejected'].includes(this.status);
  }

  get totalValue() {
    if (this.average_price && this.filled_quantity) {
      return this.average_price * this.filled_quantity;
    }
    return this.order_value;
  }

  async updateFromAlpaca(alpacaOrderData) {
    const updates = {
      alpaca_order_id: alpacaOrderData.id,
      status: alpacaOrderData.status,
      filled_quantity: parseFloat(alpacaOrderData.filled_qty || 0),
      average_price: parseFloat(alpacaOrderData.filled_avg_price || 0),
    };

    if (alpacaOrderData.submitted_at) {
      updates.submitted_at = new Date(alpacaOrderData.submitted_at);
    }

    if (alpacaOrderData.filled_at) {
      updates.filled_at = new Date(alpacaOrderData.filled_at);
    }

    if (alpacaOrderData.canceled_at) {
      updates.cancelled_at = new Date(alpacaOrderData.canceled_at);
    }

    return this.update(updates);
  }
}

Order.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  alpaca_order_id: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: true
  },
  symbol: {
    type: DataTypes.STRING(10),
    allowNull: false
  },
  side: {
    type: DataTypes.ENUM('buy', 'sell'),
    allowNull: false
  },
  order_type: {
    type: DataTypes.ENUM('market', 'limit', 'stop', 'stop_limit'),
    allowNull: false
  },
  time_in_force: {
    type: DataTypes.ENUM('day', 'gtc', 'ioc', 'fok'),
    defaultValue: 'day'
  },
  quantity: {
    type: DataTypes.DECIMAL(15, 6),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  filled_quantity: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  limit_price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  stop_price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  average_price: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  status: {
    type: DataTypes.ENUM(
      'pending', 'new', 'partially_filled', 'filled', 'done_for_day',
      'canceled', 'expired', 'replaced', 'pending_cancel', 'pending_replace',
      'accepted', 'pending_new', 'accepted_for_bidding', 'stopped',
      'rejected', 'suspended', 'calculated'
    ),
    defaultValue: 'pending'
  },
  order_value: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  fees: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  currency: {
    type: DataTypes.ENUM('KES', 'USD'),
    allowNull: false
  },
  exchange_rate: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  submitted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  filled_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  sequelize,
  modelName: 'Order',
  tableName: 'orders',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['alpaca_order_id'],
      unique: true,
      where: {
        alpaca_order_id: {
          [sequelize.Sequelize.Op.ne]: null
        }
      }
    },
    {
      fields: ['symbol']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    },
    {
      fields: ['user_id', 'status']
    }
  ]
});

module.exports = Order;