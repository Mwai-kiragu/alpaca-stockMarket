const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const KYCDocument = sequelize.define('KYCDocument', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  registrationId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  documentType: {
    type: DataTypes.ENUM(
      'government_id', 'id_front', 'id_back',
      'passport', 'drivers_license',
      'proof_of_address', 'bank_statement',
      'utility_bill'
    ),
    allowNull: false
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  originalFileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false
  },
  verificationStatus: {
    type: DataTypes.ENUM('pending', 'approved', 'rejected', 'under_review'),
    allowNull: false,
    defaultValue: 'pending'
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  verifiedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  verifiedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
    comment: 'Additional metadata like extracted text, image quality, etc.'
  }
}, {
  tableName: 'kyc_documents',
  timestamps: true,
  indexes: [
    {
      fields: ['registrationId']
    },
    {
      fields: ['documentType']
    },
    {
      fields: ['verificationStatus']
    },
    {
      unique: true,
      fields: ['registrationId', 'documentType']
    }
  ]
});

module.exports = KYCDocument;