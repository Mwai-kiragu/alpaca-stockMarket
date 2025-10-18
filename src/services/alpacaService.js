const axios = require('axios');
const logger = require('../utils/logger');

class AlpacaService {
  constructor() {
    // Use Broker API credentials for account creation
    this.brokerApiKey = process.env.ALPACA_BROKER_API_KEY;
    this.brokerSecretKey = process.env.ALPACA_BROKER_SECRET_KEY;
    this.brokerUrl = process.env.ALPACA_BROKER_API_URL || 'https://broker-api.sandbox.alpaca.markets';

    // Paper Trading API (commented out in env, but keeping for future use)
    this.paperApiKey = process.env.ALPACA_PAPER_API_KEY;
    this.paperSecretKey = process.env.ALPACA_PAPER_SECRET_KEY;
    this.paperUrl = process.env.ALPACA_PAPER_API_URL || 'https://paper-api.alpaca.markets';

    // Use broker credentials by default for now
    this.apiKey = this.brokerApiKey;
    this.secretKey = this.brokerSecretKey;

    // Trading URL for market data and trading operations
    this.tradingUrl = this.paperUrl || 'https://paper-api.alpaca.markets';
    // Use the broker URL for account operations
    this.baseUrl = this.brokerUrl;
    this.dataBaseUrl = 'https://data.alpaca.markets';

    // Headers for Broker API
    this.tradingHeaders = {
      'APCA-API-KEY-ID': this.brokerApiKey,
      'APCA-API-SECRET-KEY': this.brokerSecretKey,
      'Content-Type': 'application/json'
    };

    // Headers for Paper Trading API (if needed)
    this.paperHeaders = {
      'APCA-API-KEY-ID': this.paperApiKey,
      'APCA-API-SECRET-KEY': this.paperSecretKey,
      'Content-Type': 'application/json'
    };
  }

  // Map international addresses to valid US equivalents for Alpaca
  mapToUSState(state) {
    if (!state) return 'NY';

    // Common international to US state mappings
    const stateMapping = {
      // Kenya
      'Nairobi County': 'NY',
      'Mombasa County': 'CA',
      'Kisumu County': 'IL',
      'Nakuru County': 'TX',
      'Eldoret': 'FL',

      // Other common patterns
      'Lagos': 'NY',
      'Johannesburg': 'CA',
      'Cape Town': 'FL',
      'London': 'NY',
      'Toronto': 'NY',
      'Vancouver': 'CA',

      // Default patterns
      'County': 'NY',
      'State': 'CA',
      'Province': 'TX'
    };

    // Check for exact match first
    if (stateMapping[state]) {
      return stateMapping[state];
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(stateMapping)) {
      if (state.toLowerCase().includes(key.toLowerCase())) {
        return value;
      }
    }

    // Default fallback
    return 'NY';
  }

  mapToUSCity(city) {
    if (!city) return 'New York';

    // Map international cities to US equivalents
    const cityMapping = {
      'Nairobi': 'New York',
      'Mombasa': 'Los Angeles',
      'Kisumu': 'Chicago',
      'Nakuru': 'Dallas',
      'Eldoret': 'Miami',
      'Lagos': 'New York',
      'Johannesburg': 'Los Angeles',
      'Cape Town': 'San Francisco',
      'London': 'Boston',
      'Toronto': 'Detroit',
      'Vancouver': 'Seattle'
    };

    return cityMapping[city] || city;
  }

  mapToUSZipCode(zipCode) {
    if (!zipCode) return '10001';

    // Map international zip patterns to US equivalents
    if (zipCode.startsWith('00')) return '10001'; // Kenya 00xxx -> NY
    if (zipCode.startsWith('20')) return '90210'; // Kenya 20xxx -> CA
    if (zipCode.startsWith('40')) return '60601'; // Kenya 40xxx -> IL
    if (zipCode.startsWith('30')) return '75201'; // Kenya 30xxx -> TX

    // If it's already US format (5 digits), keep it
    if (/^\d{5}(-\d{4})?$/.test(zipCode)) {
      return zipCode;
    }

    // Default fallback
    return '10001';
  }

  mapCountryToAlpacaFormat(country) {
    if (!country) return 'USA';

    const countryMappings = {
      // Major markets
      'kenya': 'KEN',
      'united states': 'USA',
      'usa': 'USA',
      'united kingdom': 'GBR',
      'uk': 'GBR',
      'canada': 'CAN',
      'australia': 'AUS',
      'south africa': 'ZAF',

      // African countries
      'nigeria': 'NGA',
      'ghana': 'GHA',
      'uganda': 'UGA',
      'tanzania': 'TZA',
      'rwanda': 'RWA',
      'ethiopia': 'ETH',
      'egypt': 'EGY',
      'morocco': 'MAR',
      'botswana': 'BWA',
      'zambia': 'ZMB',
      'zimbabwe': 'ZWE',
      'malawi': 'MWI',
      'mozambique': 'MOZ',
      'namibia': 'NAM',
      'burundi': 'BDI',
      'sudan': 'SDN',
      'south sudan': 'SSD',
      'somalia': 'SOM',
      'democratic republic of congo': 'COD',
      'congo': 'COG',
      'cameroon': 'CMR',
      'ivory coast': 'CIV',
      'senegal': 'SEN',
      'mali': 'MLI',
      'burkina faso': 'BFA',
      'niger': 'NER',
      'chad': 'TCD',
      'benin': 'BEN',
      'togo': 'TGO',
      'liberia': 'LBR',
      'sierra leone': 'SLE',
      'guinea': 'GIN',
      'gambia': 'GMB',
      'mauritania': 'MRT',
      'algeria': 'DZA',
      'tunisia': 'TUN',
      'libya': 'LBY',
      'madagascar': 'MDG',
      'mauritius': 'MUS',
      'seychelles': 'SYC',
      'angola': 'AGO',
      'gabon': 'GAB',
      'equatorial guinea': 'GNQ',
      'central african republic': 'CAF',
      'djibouti': 'DJI',
      'eritrea': 'ERI',
      'lesotho': 'LSO',
      'swaziland': 'SWZ',
      'eswatini': 'SWZ',

      // Asian countries
      'china': 'CHN',
      'india': 'IND',
      'japan': 'JPN',
      'indonesia': 'IDN',
      'malaysia': 'MYS',
      'singapore': 'SGP',
      'thailand': 'THA',
      'vietnam': 'VNM',
      'philippines': 'PHL',
      'south korea': 'KOR',
      'taiwan': 'TWN',
      'hong kong': 'HKG',
      'pakistan': 'PAK',
      'bangladesh': 'BGD',
      'sri lanka': 'LKA',
      'myanmar': 'MMR',
      'cambodia': 'KHM',
      'laos': 'LAO',
      'brunei': 'BRN',

      // European countries
      'germany': 'DEU',
      'france': 'FRA',
      'italy': 'ITA',
      'spain': 'ESP',
      'netherlands': 'NLD',
      'belgium': 'BEL',
      'switzerland': 'CHE',
      'austria': 'AUT',
      'sweden': 'SWE',
      'norway': 'NOR',
      'denmark': 'DNK',
      'finland': 'FIN',
      'poland': 'POL',
      'czech republic': 'CZE',
      'slovakia': 'SVK',
      'hungary': 'HUN',
      'romania': 'ROU',
      'bulgaria': 'BGR',
      'greece': 'GRC',
      'portugal': 'PRT',
      'ireland': 'IRL',
      'iceland': 'ISL',
      'luxembourg': 'LUX',
      'malta': 'MLT',
      'cyprus': 'CYP',
      'croatia': 'HRV',
      'slovenia': 'SVN',
      'serbia': 'SRB',
      'montenegro': 'MNE',
      'bosnia and herzegovina': 'BIH',
      'macedonia': 'MKD',
      'albania': 'ALB',
      'estonia': 'EST',
      'latvia': 'LVA',
      'lithuania': 'LTU',
      'ukraine': 'UKR',
      'belarus': 'BLR',
      'russia': 'RUS',
      'moldova': 'MDA',

      // Middle East
      'saudi arabia': 'SAU',
      'united arab emirates': 'ARE',
      'uae': 'ARE',
      'qatar': 'QAT',
      'kuwait': 'KWT',
      'bahrain': 'BHR',
      'oman': 'OMN',
      'israel': 'ISR',
      'palestine': 'PSE',
      'jordan': 'JOR',
      'lebanon': 'LBN',
      'syria': 'SYR',
      'iraq': 'IRQ',
      'iran': 'IRN',
      'turkey': 'TUR',
      'yemen': 'YEM',

      // Americas
      'brazil': 'BRA',
      'argentina': 'ARG',
      'chile': 'CHL',
      'colombia': 'COL',
      'peru': 'PER',
      'venezuela': 'VEN',
      'ecuador': 'ECU',
      'bolivia': 'BOL',
      'paraguay': 'PRY',
      'uruguay': 'URY',
      'guyana': 'GUY',
      'suriname': 'SUR',
      'french guiana': 'GUF',
      'mexico': 'MEX',
      'guatemala': 'GTM',
      'belize': 'BLZ',
      'honduras': 'HND',
      'el salvador': 'SLV',
      'nicaragua': 'NIC',
      'costa rica': 'CRI',
      'panama': 'PAN',
      'jamaica': 'JAM',
      'haiti': 'HTI',
      'dominican republic': 'DOM',
      'cuba': 'CUB',
      'puerto rico': 'PRI',
      'trinidad and tobago': 'TTO',
      'barbados': 'BRB',

      // Oceania
      'new zealand': 'NZL',
      'fiji': 'FJI',
      'papua new guinea': 'PNG',
      'solomon islands': 'SLB',
      'vanuatu': 'VUT',
      'samoa': 'WSM',
      'tonga': 'TON',
      'palau': 'PLW'
    };

    const normalizedCountry = country.toLowerCase().trim();
    return countryMappings[normalizedCountry] || 'USA'; // Default to USA for Alpaca compatibility
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
          city: this.mapToUSCity(userData.address?.city) || 'New York',
          state: this.mapToUSState(userData.address?.state) || 'NY',
          postal_code: this.mapToUSZipCode(userData.address?.postalCode) || '10001',
          country: 'USA' // Alpaca requires USA even for international users
        },
        identity: {
          given_name: userData.firstName,
          family_name: userData.lastName,
          date_of_birth: userData.dateOfBirth instanceof Date
            ? userData.dateOfBirth.toISOString().split('T')[0]
            : (typeof userData.dateOfBirth === 'string'
              ? userData.dateOfBirth.split('T')[0]
              : '1990-01-01'), // Handle both Date objects and strings
          tax_id_type: 'USA_SSN',
          tax_id: generateTestSSN(), // Generate realistic test SSN for sandbox
          country_of_citizenship: this.mapCountryToAlpacaFormat(userData.address?.country),
          country_of_birth: this.mapCountryToAlpacaFormat(userData.identity?.nationality || userData.address?.country),
          country_of_tax_residence: this.mapCountryToAlpacaFormat(userData.address?.country),
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

      // Use broker API for account creation, not trading API
      const response = await axios.post(`${this.brokerUrl}/v1/accounts`, accountData, {
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

  async getAccount(accountId = null) {
    try {
      // If accountId is provided, use Broker API, otherwise use Paper Trading API for trading account
      const endpoint = accountId
        ? `${this.baseUrl}/v1/accounts/${accountId}`  // Broker API for specific account
        : `${this.paperUrl}/v2/account`;  // Paper Trading API for trading account

      const headers = accountId ? this.tradingHeaders : this.paperHeaders;

      const response = await axios.get(endpoint, {
        headers: headers
      });
      return response.data;
    } catch (error) {
      logger.error('Get Alpaca account error:', error.response?.data || error.message);
      throw new Error('Failed to get account information');
    }
  }

  // Get account status from Alpaca for Broker API accounts
  async getAccountStatus(accountId) {
    try {
      const response = await axios.get(`${this.baseUrl}/v1/accounts/${accountId}`, {
        headers: this.tradingHeaders
      });

      const account = response.data;

      // Map Alpaca account status to our KYC status
      const statusMapping = {
        'SUBMITTED': 'submitted',
        'ACCOUNT_UPDATED': 'under_review',
        'APPROVAL_PENDING': 'pending',
        'APPROVED': 'approved',
        'REJECTED': 'rejected',
        'ACTIVE': 'approved',
        'INACTIVE': 'rejected'
      };

      return {
        accountId: account.id,
        status: account.status,
        kycStatus: statusMapping[account.status] || 'pending',
        tradingEnabled: account.status === 'ACTIVE',
        accountType: account.account_type,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
        alpacaData: account
      };
    } catch (error) {
      logger.error('Get Alpaca account status error:', error.response?.data || error.message);
      throw new Error('Failed to get account status from Alpaca');
    }
  }

  // Check multiple accounts for admin dashboard
  async getAccountStatuses(accountIds) {
    try {
      const promises = accountIds.map(id => this.getAccountStatus(id));
      const results = await Promise.allSettled(promises);

      return results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            accountId: accountIds[index],
            error: result.reason.message,
            kycStatus: 'unknown'
          };
        }
      });
    } catch (error) {
      logger.error('Get multiple account statuses error:', error);
      throw new Error('Failed to get account statuses');
    }
  }

  async getPositions() {
    try {
      // Use Paper Trading API for positions
      const response = await axios.get(`${this.paperUrl}/v2/positions`, {
        headers: this.paperHeaders
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

      // Use Paper Trading API for orders
      const response = await axios.post(`${this.paperUrl}/v2/orders`, alpacaOrder, {
        headers: this.paperHeaders
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
      // Use Paper Trading API for orders
      const response = await axios.get(`${this.paperUrl}/v2/orders/${orderId}`, {
        headers: this.paperHeaders
      });
      return response.data;
    } catch (error) {
      logger.error('Get order error:', error.response?.data || error.message);
      throw new Error('Failed to get order');
    }
  }

  async cancelOrder(orderId) {
    try {
      // Use Paper Trading API for orders
      await axios.delete(`${this.paperUrl}/v2/orders/${orderId}`, {
        headers: this.paperHeaders
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
      // Use Paper Trading API for orders
      const response = await axios.get(`${this.paperUrl}/v2/orders`, {
        headers: this.paperHeaders,
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
      // Use Paper Trading API for market data and assets
      if (!this.paperApiKey || !this.paperSecretKey) {
        logger.warn('No valid Paper Trading API credentials configured');
        throw new Error('Paper Trading API credentials not configured. Please set ALPACA_PAPER_API_KEY and ALPACA_PAPER_SECRET_KEY in your environment variables.');
      }

      const params = {
        status,
        asset_class: assetClass
      };

      if (exchange) {
        params.exchange = exchange;
      }

      // Use Paper Trading API for assets
      const url = `${this.paperUrl}/v2/assets`;
      logger.info(`Fetching assets from Paper Trading API: ${url}`);

      const response = await axios.get(url, {
        headers: this.paperHeaders, // Use paper trading headers
        params
      });
      return response.data;
    } catch (error) {
      logger.error('Get assets error:', error.response?.data || error.message);

      // Return empty array instead of throwing for better UX
      if (error.response?.status === 401 || error.response?.status === 403) {
        logger.warn('Alpaca API authentication failed. Please check your API credentials.');
        return [];
      }

      throw error;
    }
  }

  // Get company logo from Alpaca's logo endpoint via our proxy
  getCompanyLogo(symbol, companyName = null) {
    if (!symbol) return null;

    // Return our proxy endpoint URL instead of direct Alpaca URL
    // The proxy handles authentication and serves the logo publicly
    // This allows frontend to use <img> tags directly without auth issues
    return `/api/v1/assets/logo/${symbol.toUpperCase()}`;
  }

  // Stock symbol to company name mapping
  getCompanyName(symbol) {
    const companyNames = {
      'AAPL': 'Apple Inc.',
      'GOOGL': 'Alphabet Inc. Class A',
      'GOOG': 'Alphabet Inc. Class C',
      'MSFT': 'Microsoft Corporation',
      'AMZN': 'Amazon.com Inc.',
      'TSLA': 'Tesla Inc.',
      'NVDA': 'NVIDIA Corporation',
      'META': 'Meta Platforms Inc.',
      'NFLX': 'Netflix Inc.',
      'BABA': 'Alibaba Group Holding Limited',
      'V': 'Visa Inc.',
      'JPM': 'JPMorgan Chase & Co.',
      'JNJ': 'Johnson & Johnson',
      'WMT': 'Walmart Inc.',
      'PG': 'Procter & Gamble Company',
      'UNH': 'UnitedHealth Group Incorporated',
      'HD': 'Home Depot Inc.',
      'MA': 'Mastercard Incorporated',
      'BAC': 'Bank of America Corporation',
      'DIS': 'Walt Disney Company',
      'ADBE': 'Adobe Inc.',
      'CRM': 'Salesforce Inc.',
      'PYPL': 'PayPal Holdings Inc.',
      'INTC': 'Intel Corporation',
      'CMCSA': 'Comcast Corporation',
      'PFE': 'Pfizer Inc.',
      'VZ': 'Verizon Communications Inc.',
      'T': 'AT&T Inc.',
      'ABT': 'Abbott Laboratories',
      'NKE': 'Nike Inc.',
      'KO': 'Coca-Cola Company',
      'ORCL': 'Oracle Corporation',
      'CRM': 'Salesforce Inc.',
      'AVGO': 'Broadcom Inc.',
      'ACN': 'Accenture plc',
      'TXN': 'Texas Instruments Incorporated',
      'LLY': 'Eli Lilly and Company',
      'ABBV': 'AbbVie Inc.',
      'XOM': 'Exxon Mobil Corporation',
      'CVX': 'Chevron Corporation',
      'WFC': 'Wells Fargo & Company',
      'TMO': 'Thermo Fisher Scientific Inc.',
      'COST': 'Costco Wholesale Corporation',
      'MDT': 'Medtronic plc',
      'DHR': 'Danaher Corporation',
      'NEE': 'NextEra Energy Inc.',
      'PM': 'Philip Morris International Inc.',
      'RTX': 'Raytheon Technologies Corporation',
      'LIN': 'Linde plc',
      'QCOM': 'QUALCOMM Incorporated',
      'HON': 'Honeywell International Inc.',
      'UPS': 'United Parcel Service Inc.',
      'LOW': 'Lowe\'s Companies Inc.',
      'IBM': 'International Business Machines Corporation',
      'SPGI': 'S&P Global Inc.',
      'CAT': 'Caterpillar Inc.',
      'INTU': 'Intuit Inc.',
      'GS': 'Goldman Sachs Group Inc.',
      'AMD': 'Advanced Micro Devices Inc.',
      'AMAT': 'Applied Materials Inc.',
      'BLK': 'BlackRock Inc.',
      'C': 'Citigroup Inc.',
      'MU': 'Micron Technology Inc.',
      'NOW': 'ServiceNow Inc.',
      'ISRG': 'Intuitive Surgical Inc.',
      'SYK': 'Stryker Corporation',
      'ZTS': 'Zoetis Inc.',
      'LRCX': 'Lam Research Corporation',
      'ADI': 'Analog Devices Inc.',
      'REGN': 'Regeneron Pharmaceuticals Inc.',
      'KLAC': 'KLA Corporation',
      'PANW': 'Palo Alto Networks Inc.',
      'CSX': 'CSX Corporation',
      'SNPS': 'Synopsys Inc.',
      'CDNS': 'Cadence Design Systems Inc.',
      'MRVL': 'Marvell Technology Inc.',
      'CRWD': 'CrowdStrike Holdings Inc.',
      'FTNT': 'Fortinet Inc.',
      'ADSK': 'Autodesk Inc.',
      'NXPI': 'NXP Semiconductors N.V.',
      'WDAY': 'Workday Inc.',
      'TEAM': 'Atlassian Corporation',
      'DDOG': 'Datadog Inc.',
      'SNOW': 'Snowflake Inc.',
      'ZM': 'Zoom Video Communications Inc.',
      'CZR': 'Caesars Entertainment Inc.',
      'ROKU': 'Roku Inc.',
      'PLTR': 'Palantir Technologies Inc.',
      'U': 'Unity Software Inc.',
      'RBLX': 'Roblox Corporation',
      'COIN': 'Coinbase Global Inc.',
      'RIVN': 'Rivian Automotive Inc.',
      'LCID': 'Lucid Group Inc.',
      'HOOD': 'Robinhood Markets Inc.'
    };

    return companyNames[symbol.toUpperCase()] || symbol;
  }

  async getAsset(symbol) {
    try {
      // Fetch asset details from Paper Trading API to get the real company name
      const assetResponse = await axios.get(`${this.paperUrl}/v2/assets/${symbol.toUpperCase()}`, {
        headers: this.paperHeaders
      });

      const asset = assetResponse.data;

      // Return asset data with proper company name and logo
      return {
        symbol: asset.symbol,
        name: asset.name, // Use real company name from Alpaca
        logo: this.getCompanyLogo(asset.symbol, asset.name), // Pass company name for domain derivation
        exchange: asset.exchange,
        class: asset.class,
        status: asset.status,
        tradable: asset.tradable,
        marginable: asset.marginable,
        shortable: asset.shortable,
        easy_to_borrow: asset.easy_to_borrow,
        fractionable: asset.fractionable
      };
    } catch (error) {
      logger.error('Get asset error:', error.response?.data || error.message);

      // If asset fetch fails, try snapshot as fallback
      if (error.response?.status === 404) {
        throw new Error(`Asset ${symbol} not found`);
      }
      throw new Error('Failed to get asset');
    }
  }

  async getLatestQuote(symbol) {
    try {
      // Use Paper Trading API for market data
      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/${symbol}/quotes/latest`, {
        headers: this.paperHeaders
      });
      return response.data.quote;
    } catch (error) {
      // Use debug level for missing quotes as some assets legitimately don't have real-time quotes
      logger.debug('Get latest quote error:', error.response?.data || error.message);
      throw new Error('Failed to get latest quote');
    }
  }

  async getLatestTrade(symbol) {
    try {
      // Use Paper Trading API for market data
      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/${symbol}/trades/latest`, {
        headers: this.paperHeaders
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

      // Use Paper Trading API for market data
      const response = await axios.get(`${this.dataBaseUrl}/v2/stocks/bars`, {
        headers: this.paperHeaders,
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

      // If symbols is an array, join them with commas
      if (symbols && symbols.length > 0) {
        params.symbols = Array.isArray(symbols) ? symbols.join(',') : symbols;
      }

      // Use Paper Trading API for news data
      const response = await axios.get(`${this.dataBaseUrl}/v1beta1/news`, {
        headers: this.paperHeaders,
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

      // Use Paper Trading API for market calendar
      const response = await axios.get(`${this.paperUrl}/v2/calendar`, {
        headers: this.paperHeaders,
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
      // Use Paper Trading API for market status
      logger.info('Getting market status from:', `${this.paperUrl}/v2/clock`);
      const response = await axios.get(`${this.paperUrl}/v2/clock`, {
        headers: this.paperHeaders
      });
      logger.info('Market status response received:', response.data);
      return response.data;
    } catch (error) {
      logger.error('Get market status error:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      // Return default values if API fails
      return {
        is_open: false,
        next_open: null,
        next_close: null,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get most active stocks from Alpaca screener
   * @param {number} limit - Number of stocks to return (default 30)
   * @returns {Promise<Array>} Array of most active stock symbols
   */
  async getMostActiveStocks(limit = 30) {
    try {
      const response = await axios.get(`${this.dataBaseUrl}/v1beta1/screener/stocks/most-actives`, {
        headers: this.paperHeaders,
        params: {
          by: 'volume',
          top: Math.min(limit, 50) // Alpaca limits to 50
        }
      });

      // Extract just the symbols
      const symbols = response.data.most_actives.map(stock => stock.symbol);
      logger.info(`Retrieved ${symbols.length} most active stocks from Alpaca screener`);
      return symbols;
    } catch (error) {
      logger.error('Get most active stocks error:', error.response?.data || error.message);

      // Fallback: Get regular tradable assets and return top symbols
      logger.warn('Screener API failed, falling back to regular assets endpoint');
      try {
        const assets = await this.getAssets('active', 'us_equity');

        // Filter to major exchanges and sort by symbol (basic fallback)
        const majorExchangeAssets = assets
          .filter(asset => ['NASDAQ', 'NYSE'].includes(asset.exchange) && asset.tradable)
          .slice(0, Math.min(limit, 30))
          .map(asset => asset.symbol);

        logger.info(`Fallback: Retrieved ${majorExchangeAssets.length} assets from regular endpoint`);
        return majorExchangeAssets;
      } catch (fallbackError) {
        logger.error('Fallback assets fetch also failed:', fallbackError.message);
        return []; // Return empty array if everything fails
      }
    }
  }

  // ============================================================
  // WATCHLIST MANAGEMENT - Alpaca API Integration
  // ============================================================

  /**
   * Get all watchlists for the authenticated user
   * @returns {Promise<Array>} Array of watchlist objects
   */
  async getAllWatchlists() {
    try {
      const response = await axios.get(`${this.paperUrl}/v2/watchlists`, {
        headers: this.paperHeaders
      });

      logger.info(`Retrieved ${response.data.length} watchlists from Alpaca`);
      return response.data;
    } catch (error) {
      logger.error('Get all watchlists error:', error.response?.data || error.message);
      throw new Error('Failed to get watchlists');
    }
  }

  /**
   * Create a new watchlist
   * @param {string} name - Name of the watchlist
   * @param {Array<string>} symbols - Array of stock symbols
   * @returns {Promise<Object>} Created watchlist object
   */
  async createWatchlist(name, symbols = []) {
    try {
      const response = await axios.post(
        `${this.paperUrl}/v2/watchlists`,
        {
          name: name,
          symbols: symbols
        },
        {
          headers: this.paperHeaders
        }
      );

      logger.info(`Watchlist "${name}" created successfully with ${symbols.length} symbols`);
      return response.data;
    } catch (error) {
      logger.error('Create watchlist error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.message || 'Failed to create watchlist');
    }
  }

  /**
   * Get a specific watchlist by ID
   * @param {string} watchlistId - UUID of the watchlist
   * @returns {Promise<Object>} Watchlist object with assets
   */
  async getWatchlistById(watchlistId) {
    try {
      logger.info(`Fetching watchlist by ID: ${watchlistId} from ${this.paperUrl}/v2/watchlists/${watchlistId}`);

      const response = await axios.get(`${this.paperUrl}/v2/watchlists/${watchlistId}`, {
        headers: this.paperHeaders
      });

      logger.info(`Watchlist ${watchlistId} response:`, JSON.stringify(response.data, null, 2));
      logger.info(`Assets count: ${response.data.assets ? response.data.assets.length : 0}`);
      logger.info(`Assets array:`, response.data.assets);

      return response.data;
    } catch (error) {
      logger.error('Get watchlist by ID error:', error.response?.data || error.message);
      throw new Error('Failed to get watchlist');
    }
  }

  /**
   * Update a watchlist (name and/or symbols)
   * @param {string} watchlistId - UUID of the watchlist
   * @param {string} name - New name for the watchlist
   * @param {Array<string>} symbols - New array of symbols
   * @returns {Promise<Object>} Updated watchlist object
   */
  async updateWatchlist(watchlistId, name, symbols) {
    try {
      const response = await axios.put(
        `${this.paperUrl}/v2/watchlists/${watchlistId}`,
        {
          name: name,
          symbols: symbols
        },
        {
          headers: this.paperHeaders
        }
      );

      logger.info(`Watchlist ${watchlistId} updated successfully`);
      return response.data;
    } catch (error) {
      logger.error('Update watchlist error:', error.response?.data || error.message);
      throw new Error('Failed to update watchlist');
    }
  }

  /**
   * Add a symbol to a watchlist
   * @param {string} watchlistId - UUID of the watchlist
   * @param {string} symbol - Stock symbol to add
   * @returns {Promise<Object>} Updated watchlist object
   */
  async addSymbolToWatchlist(watchlistId, symbol) {
    try {
      const response = await axios.post(
        `${this.paperUrl}/v2/watchlists/${watchlistId}`,
        {
          symbol: symbol.toUpperCase()
        },
        {
          headers: this.paperHeaders
        }
      );

      logger.info(`Symbol ${symbol} added to watchlist ${watchlistId}`);
      return response.data;
    } catch (error) {
      logger.error('Add symbol to watchlist error:', error.response?.data || error.message);

      if (error.response?.status === 422) {
        throw new Error('Symbol already exists in watchlist or is invalid');
      }

      throw new Error('Failed to add symbol to watchlist');
    }
  }

  /**
   * Remove a symbol from a watchlist
   * @param {string} watchlistId - UUID of the watchlist
   * @param {string} symbol - Stock symbol to remove
   * @returns {Promise<Object>} Updated watchlist object
   */
  async removeSymbolFromWatchlist(watchlistId, symbol) {
    try {
      const response = await axios.delete(
        `${this.paperUrl}/v2/watchlists/${watchlistId}/${symbol.toUpperCase()}`,
        {
          headers: this.paperHeaders
        }
      );

      logger.info(`Symbol ${symbol} removed from watchlist ${watchlistId}`);
      return response.data;
    } catch (error) {
      logger.error('Remove symbol from watchlist error:', error.response?.data || error.message);
      throw new Error('Failed to remove symbol from watchlist');
    }
  }

  /**
   * Delete a watchlist
   * @param {string} watchlistId - UUID of the watchlist
   * @returns {Promise<boolean>} Success status
   */
  async deleteWatchlist(watchlistId) {
    try {
      await axios.delete(`${this.paperUrl}/v2/watchlists/${watchlistId}`, {
        headers: this.paperHeaders
      });

      logger.info(`Watchlist ${watchlistId} deleted successfully`);
      return true;
    } catch (error) {
      logger.error('Delete watchlist error:', error.response?.data || error.message);
      throw new Error('Failed to delete watchlist');
    }
  }

  /**
   * Get watchlist with enriched market data for each symbol
   * @param {string} watchlistId - UUID of the watchlist
   * @returns {Promise<Object>} Watchlist with real-time quotes and price changes
   */
  async getWatchlistWithMarketData(watchlistId) {
    try {
      const watchlist = await this.getWatchlistById(watchlistId);

      if (!watchlist.assets || watchlist.assets.length === 0) {
        return {
          ...watchlist,
          enrichedAssets: []
        };
      }

      // Fetch market data for all symbols in parallel
      const marketDataPromises = watchlist.assets.map(async (asset) => {
        try {
          const quote = await this.getLatestQuote(asset.symbol);
          const bars = await this.getBars(asset.symbol, '1Day', null, null, 2);

          // Use real company name from asset or fall back to hardcoded
          const companyName = asset.name || this.getCompanyName(asset.symbol);

          let changePercent = 0;
          let change = 0;
          if (bars.length >= 2) {
            const currentPrice = quote.ap || quote.bp;
            const previousClose = parseFloat(bars[bars.length - 2].c);
            change = currentPrice - previousClose;
            changePercent = (change / previousClose) * 100;
          }

          return {
            symbol: asset.symbol,
            name: companyName,
            logo: this.getCompanyLogo(asset.symbol, companyName),
            price: quote.ap || quote.bp,
            askPrice: quote.ap,
            bidPrice: quote.bp,
            change: change,
            changePercent: changePercent.toFixed(2),
            timestamp: quote.t,
            exchange: asset.exchange,
            assetClass: asset.class
          };
        } catch (error) {
          logger.warn(`Failed to get market data for ${asset.symbol}:`, error.message);
          const companyName = asset.name || this.getCompanyName(asset.symbol);
          return {
            symbol: asset.symbol,
            name: companyName,
            logo: this.getCompanyLogo(asset.symbol, companyName),
            price: 0,
            askPrice: 0,
            bidPrice: 0,
            change: 0,
            changePercent: '0.00',
            timestamp: new Date().toISOString(),
            error: 'Market data unavailable'
          };
        }
      });

      const enrichedAssets = await Promise.all(marketDataPromises);

      return {
        id: watchlist.id,
        name: watchlist.name,
        account_id: watchlist.account_id,
        created_at: watchlist.created_at,
        updated_at: watchlist.updated_at,
        assets: enrichedAssets,
        count: enrichedAssets.length
      };
    } catch (error) {
      logger.error('Get watchlist with market data error:', error.response?.data || error.message);
      throw new Error('Failed to get watchlist with market data');
    }
  }
}

module.exports = new AlpacaService();