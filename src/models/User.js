const { DataTypes, Model } = require('sequelize');
const bcrypt = require('bcryptjs');
const { sequelize } = require('../config/database');

class User extends Model {
  async comparePassword(candidatePassword) {
    if (!this.password) return false;
    return bcrypt.compare(candidatePassword, this.password);
  }

  async incLoginAttempts() {
    const updates = { login_attempts: this.login_attempts + 1 };

    if (this.lock_until && this.lock_until < new Date()) {
      updates.login_attempts = 1;
      updates.lock_until = null;
    }

    if (this.login_attempts + 1 >= 5 && !this.isLocked) {
      updates.lock_until = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    }

    return this.update(updates);
  }

  get isLocked() {
    return !!(this.lock_until && this.lock_until > new Date());
  }

  get fullName() {
    return `${this.first_name} ${this.last_name}`;
  }
}

User.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  first_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  last_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [2, 100]
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
      notEmpty: true
    }
  },
  phone: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      len: [6, 255]
    }
  },
  is_email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_phone_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  kyc_status: {
    type: DataTypes.ENUM('pending', 'submitted', 'approved', 'rejected'),
    defaultValue: 'pending'
  },
  kyc_data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  alpaca_account_id: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true
  },
  role: {
    type: DataTypes.ENUM('user', 'admin', 'support'),
    defaultValue: 'user'
  },
  status: {
    type: DataTypes.ENUM('active', 'suspended', 'closed'),
    defaultValue: 'active'
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true
  },
  login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lock_until: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  sequelize,
  modelName: 'User',
  tableName: 'users',
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(12);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  },
  indexes: [
    {
      fields: ['email']
    },
    {
      fields: ['phone']
    },
    {
      fields: ['alpaca_account_id'],
      unique: true,
      where: {
        alpaca_account_id: {
          [sequelize.Sequelize.Op.ne]: null
        }
      }
    }
  ]
});

module.exports = User;