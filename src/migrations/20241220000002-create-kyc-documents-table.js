'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kyc_documents', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      registrationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      documentType: {
        type: Sequelize.ENUM(
          'government_id', 'id_front', 'id_back',
          'passport', 'drivers_license',
          'proof_of_address', 'bank_statement',
          'utility_bill'
        ),
        allowNull: false
      },
      fileName: {
        type: Sequelize.STRING,
        allowNull: false
      },
      originalFileName: {
        type: Sequelize.STRING,
        allowNull: false
      },
      filePath: {
        type: Sequelize.STRING,
        allowNull: false
      },
      fileSize: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      mimeType: {
        type: Sequelize.STRING,
        allowNull: false
      },
      verificationStatus: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'under_review'),
        allowNull: false,
        defaultValue: 'pending'
      },
      rejectionReason: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      verifiedBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      verifiedAt: {
        type: Sequelize.DATE,
        allowNull: true
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Add indexes
    await queryInterface.addIndex('kyc_documents', ['registrationId']);
    await queryInterface.addIndex('kyc_documents', ['documentType']);
    await queryInterface.addIndex('kyc_documents', ['verificationStatus']);

    // Add unique constraint for registrationId and documentType
    await queryInterface.addConstraint('kyc_documents', {
      fields: ['registrationId', 'documentType'],
      type: 'unique',
      name: 'unique_registration_document_type'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('kyc_documents');
  }
};