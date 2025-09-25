const axios = require('axios');
const logger = require('../utils/logger');

class AlpacaService {
  constructor() {
    this.apiKey = process.env.ALPACA_API_KEY;
    this.secretKey = process.env.ALPACA_SECRET_KEY;
    this.baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    this.dataBaseUrl = process.env.ALPACA_DATA_BASE_URL || 'https://data.alpaca.markets';

    this.tradingHeaders = {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json'
    };
  }

  async createAccount(userData) {
    try {
      // Generate a realistic test SSN for sandbox
      const generateTestSSN = () => {
        return '900' + Math.floor(Math.random() * 90 + 10) + Math.floor(Math.random() * 9000 + 1000);
      };

      // Format phone number for Alpaca (must be US format for now)
      const formatPhone = (phone) => {
        if (!phone) return '15551234567'; // Default test phone

        // Remove all non-digits
        const digitsOnly = phone.replace(/\D/g, '');

        // If it's an international number (like +254...), convert to US format for Alpaca
        if (digitsOnly.length > 10) {
          // For testing purposes, generate a US phone number
          const areaCode = Math.floor(Math.random() * 900) + 100; // 100-999
          const exchange = Math.floor(Math.random() * 900) + 100; // 100-999
          const number = Math.floor(Math.random() * 9000) + 1000; // 1000-9999
          return `1${areaCode}${exchange}${number}`;
        }

        // If it's already 10 digits, assume US and add country code
        if (digitsOnly.length === 10) {
          return `1${digitsOnly}`;
        }

        return '15551234567'; // Fallback
      };

      // For Alpaca Broker API, we need proper account creation data
      const accountData = {
        contact: {
          email_address: userData.email,
          phone_number: formatPhone(userData.phone),
          street_address: [userData.address?.street || '123 Main St'],
          city: userData.address?.city || 'New York',
          state: userData.address?.state || 'NY',
          postal_code: userData.address?.postalCode || '10001',
          country: 'USA' // Alpaca requires USA even for international users
        },
        identity: {
          given_name: userData.firstName,
          family_name: userData.lastName,
          date_of_birth: userData.dateOfBirth?.split('T')[0] || '1990-01-01', // Extract date part only
          tax_id_type: 'USA_SSN',
          tax_id: generateTestSSN(), // Generate realistic test SSN for sandbox
          country_of_citizenship: 'USA', // Required by Alpaca for now
          country_of_birth: 'USA', // Required by Alpaca for now
          country_of_tax_residence: 'USA', // Required by Alpaca for now
          funding_source: ['employment_income']
        },
        disclosures: {
          is_control_person: false,
          is_affiliated_exchange_or_finra: false,
          is_politically_exposed: false,
          immediate_family_exposed: false,
          employment_status: userData.employment?.status?.toLowerCase() || 'employed',
          employer_name: userData.employment?.employerName || 'Self Employed',
          employer_address: userData.address?.street || '123 Main St',
          employment_position: userData.employment?.jobTitle || 'Developer'
        },
        agreements: [
          {
            agreement: 'account_agreement',
            signed_at: new Date().toISOString(),
            ip_address: '127.0.0.1'
          },
          {
            agreement: 'customer_agreement',
            signed_at: new Date().toISOString(),
            ip_address: '127.0.0.1'
          },
          {
            agreement: 'margin_agreement',
            signed_at: new Date().toISOString(),
            ip_address: '127.0.0.1'
          }
        ]
      };

      // Add documents if available
      if (userData.documents && userData.documents.length > 0) {
        accountData.documents = userData.documents.map(doc => ({
          document_type: 'identity_verification',
          document_sub_type: doc.type || 'passport',
          content: doc.base64Content || doc.content,
          mime_type: doc.mimeType || 'image/jpeg'
        }));
      }

      logger.info('Creating Alpaca account with formatted data:', {
        originalData: {
          name: `${userData.firstName} ${userData.lastName}`,
          email: userData.email,
          phone: userData.phone,
          address: userData.address,
          employment: userData.employment
        },
        alpacaData: {
          contact: accountData.contact,
          identity: {
            ...accountData.identity,
            tax_id: '[HIDDEN]' // Don't log SSN
          },
          disclosures: accountData.disclosures
        }
      });

      const response = await axios.post(`${this.baseUrl}/v1/accounts`, accountData, {
        headers: this.tradingHeaders,
        timeout: 30000 // 30 second timeout
      });

      logger.info('Alpaca account created successfully:', {
        userId: userData.userId,
        accountId: response.data.id,
        status: response.data.status
      });

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      const errorDetails = error.response?.data || {};

      logger.error('Alpaca account creation error:', {
        message: errorMessage,
        status: error.response?.status,
        details: errorDetails,
        userData: {
          email: userData.email,
          userId: userData.userId
        }
      });

      throw new Error(`Failed to create Alpaca account: ${errorMessage}`);
    }
  }

  async getAccount() {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/account`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get Alpaca account error:', error.response?.data || error.message);
      throw new Error('Failed to get account information');
    }
  }

  async getPositions() {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/positions`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get positions error:', error.response?.data || error.message);
      throw new Error('Failed to get positions');
    }
  }

  async createOrder(orderData) {
    try {
      const alpacaOrder = {
        symbol: orderData.symbol,
        qty: orderData.quantity,
        side: orderData.side,
        type: orderData.orderType,
        time_in_force: orderData.timeInForce || 'day',
        client_order_id: orderData.clientOrderId
      };

      if (orderData.orderType === 'limit' || orderData.orderType === 'stop_limit') {
        alpacaOrder.limit_price = orderData.limitPrice;
      }

      if (orderData.orderType === 'stop' || orderData.orderType === 'stop_limit') {
        alpacaOrder.stop_price = orderData.stopPrice;
      }

      if (orderData.extendedHours) {
        alpacaOrder.extended_hours = true;
      }

      const response = await axios.post(`${this.baseUrl}/v2/orders`, alpacaOrder, {
        headers: this.tradingHeaders
      });

      logger.info('Alpaca order created:', {
        symbol: orderData.symbol,
        side: orderData.side,
        quantity: orderData.quantity,
        orderId: response.data.id
      });

      return response.data;
    } catch (error) {
      logger.error('Create order error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create order');
    }
  }

  async getOrder(orderId) {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/orders/${orderId}`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get order error:', error.response?.data || error.message);
      throw new Error('Failed to get order');
    }
  }

  async cancelOrder(orderId) {
    try {
      await axios.delete(`${this.baseUrl}/v2/orders/${orderId}`, {
        headers: this.tradingHeaders
      });

      logger.info('Order cancelled:', { orderId });
      return true;
    } catch (error) {
      logger.error('Cancel order error:', error.response?.data || error.message);
      throw new Error('Failed to cancel order');
    }
  }

  async getOrders(status = 'all', limit = 50) {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/orders`, {
        headers: this.tradingHeaders,
        params: { status, limit }
      });
      return response.data;
    } catch (error) {
      logger.error('Get orders error:', error.response?.data || error.message);
      throw new Error('Failed to get orders');
    }
  }

  async getAssets(status = 'active', assetClass = 'us_equity', exchange = null) {
    try {
      const params = {
        status,
        asset_class: assetClass
      };

      if (exchange) {
        params.exchange = exchange;
      }

      const response = await axios.get(`${this.baseUrl}/v2/assets`, {
        headers: this.tradingHeaders,
        params
      });
      return response.data;
    } catch (error) {
      logger.error('Get assets error:', error.response?.data || error.message);
      throw new Error('Failed to get assets');
    }
  }

  async getAsset(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/assets/${symbol}`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get asset error:', error.response?.data || error.message);
      throw new Error('Failed to get asset');
    }
  }

  async getLatestQuote(symbol) {
    try {
      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/${symbol}/quotes/latest`, {
        headers: this.tradingHeaders
      });
      return response.data.quote;
    } catch (error) {
      logger.error('Get latest quote error:', error.response?.data || error.message);
      throw new Error('Failed to get latest quote');
    }
  }

  async getLatestTrade(symbol) {
    try {
      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/${symbol}/trades/latest`, {
        headers: this.tradingHeaders
      });
      return response.data.trade;
    } catch (error) {
      logger.error('Get latest trade error:', error.response?.data || error.message);
      throw new Error('Failed to get latest trade');
    }
  }

  async getBars(symbol, timeframe = '1Day', start, end, limit = 100) {
    try {
      const params = {
        symbols: symbol,
        timeframe,
        limit
      };

      if (start) params.start = start;
      if (end) params.end = end;

      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/bars`, {
        headers: this.tradingHeaders,
        params
      });

      return response.data.bars[symbol] || [];
    } catch (error) {
      logger.error('Get bars error:', error.response?.data || error.message);
      throw new Error('Failed to get price bars');
    }
  }

  async getNews(symbols, limit = 10) {
    try {
      const params = { limit };
      if (symbols) params.symbols = symbols;

      const response = await axios.get(`${this.dataBaseUrl}/v1beta1/news`, {
        headers: this.tradingHeaders,
        params
      });

      return response.data.news || [];
    } catch (error) {
      logger.error('Get news error:', error.response?.data || error.message);
      throw new Error('Failed to get news');
    }
  }

  async searchAssets(query) {
    try {
      const assets = await this.getAssets();
      const filteredAssets = assets.filter(asset =>
        asset.symbol.toLowerCase().includes(query.toLowerCase()) ||
        asset.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 20);

      return filteredAssets;
    } catch (error) {
      logger.error('Search assets error:', error);
      throw new Error('Failed to search assets');
    }
  }

  async getAccountActivities(params = {}) {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/account/activities`, {
        headers: this.tradingHeaders,
        params
      });
      return response.data;
    } catch (error) {
      logger.error('Get account activities error:', error.response?.data || error.message);
      throw new Error('Failed to get account activities');
    }
  }

  async getAccountConfigurations() {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/account/configurations`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get account configurations error:', error.response?.data || error.message);
      throw new Error('Failed to get account configurations');
    }
  }

  async updateAccountConfigurations(updates) {
    try {
      const response = await axios.patch(`${this.baseUrl}/v2/account/configurations`, updates, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Update account configurations error:', error.response?.data || error.message);
      throw new Error('Failed to update account configurations');
    }
  }

  async getAccountDocuments() {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/account/documents`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get account documents error:', error.response?.data || error.message);
      throw new Error('Failed to get account documents');
    }
  }

  async getMarketCalendar(start, end) {
    try {
      const params = {};
      if (start) params.start = start;
      if (end) params.end = end;

      const response = await axios.get(`${this.baseUrl}/v2/calendar`, {
        headers: this.tradingHeaders,
        params
      });

      return response.data;
    } catch (error) {
      logger.error('Get market calendar error:', error.response?.data || error.message);
      throw new Error('Failed to get market calendar');
    }
  }

  async getMarketStatus() {
    try {
      const response = await axios.get(`${this.baseUrl}/v2/clock`, {
        headers: this.tradingHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get market status error:', error.response?.data || error.message);
      throw new Error('Failed to get market status');
    }
  }
}

module.exports = new AlpacaService();