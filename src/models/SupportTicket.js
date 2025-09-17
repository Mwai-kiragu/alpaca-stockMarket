const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class SupportTicketMessage extends Model {}

class SupportTicket extends Model {
  async addMessage(messageData) {
    const message = await SupportTicketMessage.create({
      ...messageData,
      support_ticket_id: this.id
    });

    // Update ticket status based on sender
    if (messageData.sender_type === 'support' && this.status === 'waiting_for_customer') {
      this.status = 'in_progress';
    } else if (messageData.sender_type === 'user' && this.status === 'in_progress') {
      this.status = 'waiting_for_customer';
    }

    await this.save();
    return message;
  }

  async resolve(resolvedBy, resolutionNotes) {
    this.status = 'resolved';
    this.resolved_by = resolvedBy;
    this.resolved_at = new Date();
    this.resolution_notes = resolutionNotes;

    return this.save();
  }

  static generateTicketId() {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `TKT-${timestamp}-${randomStr}`;
  }
}

SupportTicketMessage.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  support_ticket_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'support_tickets',
      key: 'id'
    }
  },
  sender_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  sender_type: {
    type: DataTypes.ENUM('user', 'support', 'system'),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  is_internal: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  sequelize,
  modelName: 'SupportTicketMessage',
  tableName: 'support_ticket_messages',
  indexes: [
    {
      fields: ['support_ticket_id', 'created_at']
    },
    {
      fields: ['sender_id']
    }
  ]
});

SupportTicket.init({
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
  ticket_id: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM(
      'account_issues',
      'trading_issues',
      'deposit_withdrawal',
      'technical_support',
      'kyc_verification',
      'general_inquiry',
      'complaint',
      'feature_request',
      'bug_report'
    ),
    allowNull: false
  },
  subject: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  status: {
    type: DataTypes.ENUM('open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'),
    defaultValue: 'open'
  },
  assigned_to: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  resolved_by: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  resolved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  resolution_notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  satisfaction_rating: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 1,
      max: 5
    }
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  tags: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'SupportTicket',
  tableName: 'support_tickets',
  hooks: {
    beforeCreate: (ticket) => {
      if (!ticket.ticket_id) {
        ticket.ticket_id = SupportTicket.generateTicketId();
      }
    }
  },
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['ticket_id'],
      unique: true
    },
    {
      fields: ['status']
    },
    {
      fields: ['category']
    },
    {
      fields: ['assigned_to']
    },
    {
      fields: ['created_at']
    }
  ]
});

// Associations
SupportTicket.hasMany(SupportTicketMessage, { foreignKey: 'support_ticket_id', as: 'messages' });
SupportTicketMessage.belongsTo(SupportTicket, { foreignKey: 'support_ticket_id', as: 'support_ticket' });

// Note: User associations will be defined in models/index.js to avoid circular dependencies

module.exports = { SupportTicket, SupportTicketMessage };