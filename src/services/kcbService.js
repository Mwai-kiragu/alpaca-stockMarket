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
    // KCB_CREDIT_ACCOUNT is the KCB bank account (receives deposits, sends withdrawals)
    this.kcbBankAccount = process.env.KCB_CREDIT_ACCOUNT;

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
          },
          timeout: 10000 // 10 seconds for token request
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
          },
          timeout: 25000 // 25 seconds timeout (less than Cloudflare's 30s)
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
      // Check if it's a timeout error
      const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      const is504 = error.response?.status === 504;

      logger.error('KCB transfer failed:', {
        error: error.message,
        errorCode: error.code,
        statusCode: error.response?.status,
        isTimeout: isTimeout || is504,
        response: error.response?.data,
        transactionReference: transferData.transactionReference
      });

      return {
        success: false,
        error: isTimeout || is504
          ? 'Request timeout - KCB API is currently slow or unresponsive. Please try again in a few minutes.'
          : error.message,
        errorCode: error.code,
        statusCode: error.response?.status,
        isTimeout: isTimeout || is504,
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
          },
          timeout: 15000 // 15 seconds for status check
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
      const invoiceNumber = `${this.kcbBankAccount}-${stkData.invoiceNumber}`;
      const payload = {
        phoneNumber: formattedPhone,
        amount: stkData.amount.toString(),
        invoiceNumber: invoiceNumber,
        sharedShortCode: true,
        orgShortCode: '',
        orgPassKey: '',
        callbackUrl: stkData.callbackUrl || process.env.KCB_STK_CALLBACK_URL,
        transactionDescription: 'Payment'
      };

      const stkPushUrl = process.env.KCB_STK_PUSH_URL || `${this.baseUrl}/mm/api/request/1.0.0/stkpush`;

      logger.info('KCB STK Push - Full Request:', {
        url: stkPushUrl,
        messageId,
        payload: JSON.stringify(payload)
      });

      const response = await axios.post(
        stkPushUrl,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
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
  /**
   * Withdraw funds to M-Pesa phone number (B2C)
   * Uses KCB Funds Transfer API with transactionType: MO and beneficiaryBankCode: MPESA
   */
  async withdrawToMpesa(withdrawalData) {
    try {
      const { phoneNumber, amount, beneficiaryName, reference } = withdrawalData;

      if (!phoneNumber || !amount) {
        throw new Error('Missing required fields: phoneNumber, amount');
      }

      const accessToken = await this.getAccessToken();
      const transactionReference = reference || this.generateTransactionReference();

      // Format phone number for M-Pesa (10 digits with leading 0)
      let mpesaNumber = phoneNumber.replace(/\D/g, '');
      if (mpesaNumber.startsWith('254')) {
        mpesaNumber = '0' + mpesaNumber.substring(3); // 254xxx -> 0xxx
      } else if (!mpesaNumber.startsWith('0') && mpesaNumber.length === 9) {
        mpesaNumber = '0' + mpesaNumber; // 7xxx -> 07xxx
      }

      // Funds Transfer payload for M-Pesa B2C
      const payload = {
        companyCode: process.env.KCB_COMPANY_CODE || this.companyCode,
        transactionType: 'MO', // Mobile Out
        debitAccountNumber: process.env.KCB_CREDIT_ACCOUNT || this.kcbBankAccount,
        creditAccountNumber: mpesaNumber, // M-Pesa phone number (0712345678)
        debitAmount: amount,
        paymentDetails: 'Withdrawal',
        transactionReference: transactionReference,
        currency: 'KES',
        beneficiaryDetails: beneficiaryName || 'Customer',
        beneficiaryBankCode: 'MPESA'
      };

      const withdrawUrl = process.env.KCB_WITHDRAW_URL || `${this.baseUrl}/fundstransfer/1.0.0/api/v1/transfer`;

      logger.info('KCB B2C Withdrawal - Full Request:', {
        url: withdrawUrl,
        transactionReference,
        payload: JSON.stringify(payload)
      });

      // KCB Funds Transfer endpoint for M-Pesa B2C
      const response = await axios.post(
        withdrawUrl,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      logger.info('KCB M-Pesa B2C successful:', {
        transactionReference,
        response: response.data
      });

      return {
        success: true,
        transactionReference,
        retrievalRefNumber: response.data?.header?.retrievalRefNumber || response.data?.retrievalRefNumber || transactionReference,
        phoneNumber: mpesaNumber,
        amount,
        beneficiaryName,
        statusCode: response.data?.header?.statusCode || response.data?.statusCode,
        statusDescription: response.data?.header?.statusDescription || response.data?.statusDescription,
        data: response.data
      };

    } catch (error) {
      logger.error('KCB M-Pesa B2C failed:', {
        error: error.message,
        response: error.response?.data,
        phoneNumber: withdrawalData.phoneNumber
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
        `${this.baseUrl}/v1/core/t24/querytransaction/1.0.0/api/transactioninfo`,
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
