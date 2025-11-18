const axios = require('axios');
const logger = require('../utils/logger');

class KCBService {
  constructor() {
    this.consumerKey = process.env.KCB_CONSUMER_KEY;
    this.consumerSecret = process.env.KCB_CONSUMER_SECRET;
    this.tokenUrl = process.env.KCB_TOKEN_URL;
    this.revokeUrl = process.env.KCB_REVOKE_URL;
    this.baseUrl = process.env.KCB_API_BASE_URL;
    this.companyCode = process.env.KCB_COMPANY_CODE;
    this.debitAccount = process.env.KCB_DEBIT_ACCOUNT;

    // Cache for access token
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    try {
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
        logger.debug('Using cached KCB access token');
        return this.accessToken;
      }

      logger.info('Requesting new KCB access token');

      const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

      const response = await axios.post(
        this.tokenUrl,
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      this.accessToken = response.data.access_token;

      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn * 1000);

      logger.info('KCB access token obtained successfully', {
        expiresIn: expiresIn,
        tokenType: response.data.token_type
      });

      return this.accessToken;
    } catch (error) {
      logger.error('Failed to get KCB access token:', {
        error: error.message,
        response: error.response?.data
      });
      throw new Error('Failed to authenticate with KCB API');
    }
  }

  async revokeToken() {
    try {
      if (!this.accessToken) {
        logger.warn('No KCB token to revoke');
        return;
      }

      const credentials = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

      await axios.post(
        this.revokeUrl,
        `token=${this.accessToken}&token_type_hint=access_token`,
        {
          headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      logger.info('KCB access token revoked successfully');
      this.accessToken = null;
      this.tokenExpiry = null;
    } catch (error) {
      logger.error('Failed to revoke KCB token:', error.message);
      this.accessToken = null;
      this.tokenExpiry = null;
    }
  }

  async transferFunds(transferData) {
    try {
      const accessToken = await this.getAccessToken();
      const required = ['creditAccountNumber', 'amount', 'currency', 'beneficiaryDetails', 'transactionReference'];
      for (const field of required) {
        if (!transferData[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      const payload = {
        beneficiaryDetails: transferData.beneficiaryDetails,
        companyCode: this.companyCode,
        creditAccountNumber: transferData.creditAccountNumber,
        currency: transferData.currency.toUpperCase(),
        debitAccountNumber: transferData.debitAccountNumber || this.debitAccount,
        debitAmount: transferData.amount,
        paymentDetails: transferData.paymentDetails || 'Funds transfer',
        transactionReference: transferData.transactionReference,
        transactionType: transferData.transactionType || 'IF',
        beneficiaryBankCode: transferData.beneficiaryBankCode || '01'
      };

      logger.info('Initiating KCB funds transfer:', {
        transactionReference: payload.transactionReference,
        amount: payload.debitAmount,
        currency: payload.currency,
        creditAccount: payload.creditAccountNumber
      });

      const response = await axios.post(
        `${this.baseUrl}/api/v1/transfer`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      // Log full response structure for debugging
      logger.info('KCB transfer API response:', {
        transactionReference: payload.transactionReference,
        fullResponse: JSON.stringify(response.data)
      });

      logger.info('KCB transfer successful:', {
        transactionReference: payload.transactionReference,
        retrievalRefNumber: response.data.header?.retrievalRefNumber || response.data.retrievalRefNumber,
        statusCode: response.data.header?.statusCode || response.data.statusCode
      });

      return {
        success: true,
        data: response.data,
        transactionReference: payload.transactionReference,
        retrievalRefNumber: response.data.header?.retrievalRefNumber || response.data.retrievalRefNumber,
        statusCode: response.data.header?.statusCode || response.data.statusCode,
        statusDescription: response.data.header?.statusDescription || response.data.statusDescription,
        statusMessage: response.data.header?.statusMessage || response.data.statusMessage,
        merchantID: response.data.header?.merchantID || response.data.merchantID
      };

    } catch (error) {
      logger.error('KCB transfer failed:', {
        error: error.message,
        response: error.response?.data,
        transactionReference: transferData.transactionReference
      });

      return {
        success: false,
        error: error.message,
        errorData: error.response?.data,
        transactionReference: transferData.transactionReference
      };
    }
  }

  async getTransactionStatus(transactionReference) {
    try {
      const accessToken = await this.getAccessToken();
      const response = await axios.get(
        `${this.baseUrl}/api/v1/transaction/${transactionReference}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Failed to get KCB transaction status:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RVN${timestamp}${random}`;
  }

  validateAccountNumber(accountNumber) {
    const accountRegex = /^\d{10,13}$/;
    return accountRegex.test(accountNumber);
  }

  generateMessageId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `RVN_${timestamp}_${random}`;
  }

  formatPhoneNumber(phone) {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('254')) {
      return cleanPhone;
    } else if (cleanPhone.startsWith('0')) {
      return '254' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('+254')) {
      return cleanPhone.substring(1);
    } else if (cleanPhone.length === 9) {
      return '254' + cleanPhone;
    }

    // Default assume it's a Kenyan number
    return '254' + cleanPhone;
  }
  async initiateSTKPush(stkData) {
    try {
      const accessToken = await this.getAccessToken();
      const required = ['phoneNumber', 'amount', 'invoiceNumber'];
      for (const field of required) {
        if (!stkData[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      const formattedPhone = this.formatPhoneNumber(stkData.phoneNumber);
      const messageId = this.generateMessageId();
      const payload = {
        phoneNumber: formattedPhone,
        amount: stkData.amount.toString(),
        invoiceNumber: stkData.invoiceNumber,
        sharedShortCode: true,
        orgShortCode: "",
        orgPassKey: "",
        callbackUrl: stkData.callbackUrl || process.env.KCB_STK_CALLBACK_URL || 'https://api.rivenapp.com/api/v1/callback',
        transactionDescription: stkData.transactionDescription || 'Payment'
      };

      logger.info('Initiating KCB M-Pesa STK Push:', {
        messageId,
        phoneNumber: formattedPhone,
        amount: payload.amount,
        invoiceNumber: payload.invoiceNumber
      });

      const response = await axios.post(
        'https://uat.buni.kcbgroup.com/mm/api/request/1.0.0/stkpush',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'routeCode': '207',
            'operation': 'STKPush',
            'messageId': messageId
          }
        }
      );

      logger.info('KCB STK Push successful:', {
        messageId,
        response: response.data
      });

      return {
        success: true,
        data: response.data,
        messageId,
        invoiceNumber: payload.invoiceNumber,
        phoneNumber: formattedPhone
      };

    } catch (error) {
      logger.error('KCB STK Push failed:', {
        error: error.message,
        response: error.response?.data,
        phoneNumber: stkData.phoneNumber
      });

      return {
        success: false,
        error: error.message,
        errorData: error.response?.data
      };
    }
  }
  async queryTransactionStatus(trxRequestId) {
    try {
      const accessToken = await this.getAccessToken();
      const messageId = this.generateMessageId();
      const conversationId = this.generateMessageId();

      const payload = {
        header: {
          messageId,
          conversationId,
          featureCode: 'INNOVA',
          featureName: 'INNOVA',
          serviceCode: '200',
          serviceName: 'WalletQueryTransactionStatus',
          serviceSubCategory: 'TransactionStatus',
          minorServiceVersion: '1.0',
          channelCode: '1',
          channelName: 'API',
          routeCode: '200',
          timeStamp: new Date().toISOString(),
          serviceMode: 'SYNC',
          subscribeEvents: '',
          callBackURL: process.env.KCB_QUERY_CALLBACK_URL || 'https://api.rivenapp.com/api/v1/callback/query'
        },
        payload: {
          partnerId: process.env.KCB_PARTNER_ID || '2',
          trxRequestId: trxRequestId,
          additionalData: {
            businessKey: '1',
            businessKeyValue: 'RIVEN'
          }
        }
      };

      logger.info('Querying KCB transaction status:', {
        trxRequestId,
        messageId
      });

      const response = await axios.post(
        'https://uat.buni.kcbgroup.com/v1/core/t24/querytransaction/1.0.0/api/transactioninfo',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      logger.info('KCB transaction query successful:', {
        trxRequestId,
        status: response.data
      });

      return {
        success: true,
        data: response.data,
        transactionStatus: response.data.payload?.transactionStatus || response.data.transactionStatus
      };

    } catch (error) {
      logger.error('KCB transaction query failed:', {
        error: error.message,
        response: error.response?.data,
        trxRequestId
      });

      return {
        success: false,
        error: error.message,
        errorData: error.response?.data
      };
    }
  }
}

module.exports = new KCBService();
