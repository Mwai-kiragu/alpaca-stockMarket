const axios = require('axios');
const logger = require('../utils/logger');

class MpesaDirectService {
  constructor() {
    this.consumerKey = process.env.MPESA_CONSUMER_KEY || '';
    this.consumerSecret = process.env.MPESA_CONSUMER_SECRET || '';
    this.passkey = process.env.MPESA_STK_PASSPHRASE || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    this.shortcode = process.env.MPESA_STK_SHORTCODE || '174379';
    this.tillNo = process.env.MPESA_TILL_NO || '8117544'; // From their code
    this.transactionType = process.env.MPESA_STK_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline';
    this.callbackUrl = process.env.MPESA_STK_CALLBACK_URL || 'https://your-domain.com/api/v1/wallet/mpesa/callback';

    // M-Pesa API URLs
    this.accessTokenUrl = 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
    this.stkPushUrl = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
  }

  /**
   * Get M-Pesa access token
   */
  async getAccessToken() {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

      const response = await axios.get(this.accessTokenUrl, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      if (response.data && response.data.access_token) {
        logger.info('M-Pesa access token obtained successfully');
        return response.data.access_token;
      } else {
        throw new Error('Invalid response from M-Pesa token endpoint');
      }

    } catch (error) {
      logger.error('M-Pesa access token error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error('Failed to get M-Pesa access token');
    }
  }

  /**
   * Generate timestamp in M-Pesa format (YYYYMMDDHHmmss)
   */
  generateTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}${hour}${minute}${second}`;
  }

  /**
   * Generate M-Pesa password
   */
  generatePassword(timestamp) {
    const passwordString = `${this.shortcode}${this.passkey}${timestamp}`;
    return Buffer.from(passwordString).toString('base64');
  }

  /**
   * Format phone number to M-Pesa format (254XXXXXXXXX)
   */
  formatPhoneNumber(phone) {
    // Remove any non-digits
    let cleanPhone = phone.replace(/\D/g, '');

    // Handle different formats
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

  /**
   * Initiate STK Push (based on their PHP implementation)
   * @param {number} amount - Amount to pay
   * @param {string} phone - Phone number
   * @param {string} accountReference - Account reference (invoice/transaction ID)
   * @param {string} transactionDesc - Transaction description
   */
  async initiateSTKPush(amount, phone, accountReference, transactionDesc) {
    try {
      // 1. Get access token
      const accessToken = await this.getAccessToken();

      // 2. Generate timestamp and password
      const timestamp = this.generateTimestamp();
      const password = this.generatePassword(timestamp);

      // 3. Format phone number
      const formattedPhone = this.formatPhoneNumber(phone);

      // 4. Prepare STK Push payload (exactly like their PHP implementation)
      const stkPushPayload = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: this.transactionType, // CustomerBuyGoodsOnline
        Amount: Math.round(amount), // Ensure it's an integer
        PartyA: formattedPhone,
        PartyB: this.tillNo, // Their till number
        PhoneNumber: formattedPhone,
        CallBackURL: this.callbackUrl,
        AccountReference: accountReference,
        TransactionDesc: transactionDesc
      };

      logger.info('Initiating M-Pesa STK Push:', {
        amount,
        phone: formattedPhone,
        accountReference,
        timestamp
      });

      // 5. Make STK Push request
      const response = await axios.post(this.stkPushUrl, stkPushPayload, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      logger.info('M-Pesa STK Push response:', response.data);

      // 6. Process response
      if (response.data) {
        const { ResponseCode, ResponseDescription, MerchantRequestID, CheckoutRequestID, CustomerMessage } = response.data;

        if (ResponseCode === '0') {
          // Success
          return {
            success: true,
            message: ResponseDescription,
            merchantRequestId: MerchantRequestID,
            checkoutRequestId: CheckoutRequestID,
            customerMessage: CustomerMessage,
            responseCode: ResponseCode
          };
        } else {
          // M-Pesa returned an error
          return {
            success: false,
            message: ResponseDescription || 'STK Push failed',
            responseCode: ResponseCode,
            error: response.data
          };
        }
      } else {
        throw new Error('No response data from M-Pesa');
      }

    } catch (error) {
      logger.error('STK Push initiation error:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        amount,
        phone
      });

      return {
        success: false,
        message: error.response?.data?.errorMessage || error.message || 'STK Push failed',
        error: error.response?.data || error.message
      };
    }
  }

  /**
   * Process M-Pesa callback (based on their PHP implementation)
   * @param {object} callbackData - M-Pesa callback payload
   */
  processCallback(callbackData) {
    try {
      logger.info('M-Pesa callback received:', callbackData);

      // Check if callback has the expected structure
      if (!callbackData.Body || !callbackData.Body.stkCallback) {
        logger.error('Invalid M-Pesa callback structure');
        return {
          success: false,
          message: 'Invalid callback structure'
        };
      }

      const stkCallback = callbackData.Body.stkCallback;
      const resultCode = stkCallback.ResultCode;

      if (resultCode === 0) {
        // Success - extract payment details
        const callbackMetadata = stkCallback.CallbackMetadata;
        if (!callbackMetadata || !callbackMetadata.Item) {
          logger.error('Missing callback metadata');
          return {
            success: false,
            message: 'Missing payment details'
          };
        }

        // Extract payment details from metadata items
        const metadata = {};
        callbackMetadata.Item.forEach(item => {
          switch (item.Name) {
            case 'Amount':
              metadata.amount = item.Value;
              break;
            case 'MpesaReceiptNumber':
              metadata.mpesaReceiptNumber = item.Value;
              break;
            case 'TransactionDate':
              metadata.transactionDate = item.Value;
              break;
            case 'PhoneNumber':
              metadata.phoneNumber = item.Value;
              break;
          }
        });

        return {
          success: true,
          resultCode,
          resultDesc: stkCallback.ResultDesc,
          checkoutRequestId: stkCallback.CheckoutRequestID,
          metadata
        };

      } else {
        // Payment failed
        return {
          success: false,
          resultCode,
          resultDesc: stkCallback.ResultDesc,
          checkoutRequestId: stkCallback.CheckoutRequestID
        };
      }

    } catch (error) {
      logger.error('M-Pesa callback processing error:', error);
      return {
        success: false,
        message: 'Callback processing failed',
        error: error.message
      };
    }
  }

  /**
   * Generate invoice number (like their PHP implementation)
   */
  generateInvoiceNo() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `INV${timestamp}${random}`;
  }
}

module.exports = new MpesaDirectService();