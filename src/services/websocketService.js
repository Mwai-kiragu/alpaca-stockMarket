const { Server } = require('socket.io');
const alpacaService = require('./alpacaService');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.server = null;
    this.connectedClients = new Map();
    this.subscribedSymbols = new Set();
    this.priceUpdateInterval = null;
    this.updateIntervalMs = 5000; // 5 seconds
    this.popularSymbols = [
      'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
      'V', 'JPM', 'JNJ', 'WMT', 'PG', 'UNH', 'HD', 'MA', 'BAC', 'DIS'
    ];
  }

  initialize(httpServer) {
    try {
      this.server = httpServer;
      this.io = new Server(httpServer, {
        cors: {
          origin: process.env.CLIENT_URL || "*",
          methods: ["GET", "POST"],
          credentials: true
        },
        transports: ['websocket', 'polling']
      });

      this.setupEventHandlers();
      this.startPriceUpdates();

      logger.info('WebSocket service initialized successfully');
      return this.io;
    } catch (error) {
      logger.error('Failed to initialize WebSocket service:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      // Store client connection
      this.connectedClients.set(socket.id, {
        socket: socket,
        subscribedSymbols: new Set(),
        connectedAt: new Date(),
        lastActivity: new Date()
      });

      // Handle symbol subscription
      socket.on('subscribe', (data) => {
        this.handleSubscription(socket, data);
      });

      // Handle symbol unsubscription
      socket.on('unsubscribe', (data) => {
        this.handleUnsubscription(socket, data);
      });

      // Handle bulk symbol subscription
      socket.on('subscribe_bulk', (data) => {
        this.handleBulkSubscription(socket, data);
      });

      // Handle portfolio subscription
      socket.on('subscribe_portfolio', (data) => {
        this.handlePortfolioSubscription(socket, data);
      });

      // Handle popular assets subscription
      socket.on('subscribe_popular', () => {
        this.handlePopularSubscription(socket);
      });

      // Handle ping/pong for connection health
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
        this.updateClientActivity(socket.id);
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
        this.handleDisconnection(socket.id);
      });

      // Send initial popular assets data
      this.sendInitialData(socket);
    });
  }

  handleSubscription(socket, data) {
    try {
      const { symbols } = data;
      const client = this.connectedClients.get(socket.id);

      if (!client || !symbols) return;

      const symbolArray = Array.isArray(symbols) ? symbols : [symbols];

      symbolArray.forEach(symbol => {
        const upperSymbol = symbol.toUpperCase();
        client.subscribedSymbols.add(upperSymbol);
        this.subscribedSymbols.add(upperSymbol);
      });

      socket.emit('subscription_confirmed', {
        symbols: symbolArray,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} subscribed to: ${symbolArray.join(', ')}`);
      this.updateClientActivity(socket.id);
    } catch (error) {
      logger.error('Error handling subscription:', error);
      socket.emit('error', { message: 'Subscription failed' });
    }
  }

  handleUnsubscription(socket, data) {
    try {
      const { symbols } = data;
      const client = this.connectedClients.get(socket.id);

      if (!client || !symbols) return;

      const symbolArray = Array.isArray(symbols) ? symbols : [symbols];

      symbolArray.forEach(symbol => {
        const upperSymbol = symbol.toUpperCase();
        client.subscribedSymbols.delete(upperSymbol);

        // Remove from global subscriptions if no other clients are subscribed
        const stillSubscribed = Array.from(this.connectedClients.values())
          .some(c => c.subscribedSymbols.has(upperSymbol));

        if (!stillSubscribed) {
          this.subscribedSymbols.delete(upperSymbol);
        }
      });

      socket.emit('unsubscription_confirmed', {
        symbols: symbolArray,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} unsubscribed from: ${symbolArray.join(', ')}`);
      this.updateClientActivity(socket.id);
    } catch (error) {
      logger.error('Error handling unsubscription:', error);
      socket.emit('error', { message: 'Unsubscription failed' });
    }
  }

  handleBulkSubscription(socket, data) {
    try {
      const { symbols, replace = false } = data;
      const client = this.connectedClients.get(socket.id);

      if (!client || !symbols || !Array.isArray(symbols)) return;

      if (replace) {
        // Clear existing subscriptions
        client.subscribedSymbols.clear();
      }

      symbols.forEach(symbol => {
        const upperSymbol = symbol.toUpperCase();
        client.subscribedSymbols.add(upperSymbol);
        this.subscribedSymbols.add(upperSymbol);
      });

      socket.emit('bulk_subscription_confirmed', {
        symbols: symbols,
        replace: replace,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} bulk subscribed to ${symbols.length} symbols`);
      this.updateClientActivity(socket.id);
    } catch (error) {
      logger.error('Error handling bulk subscription:', error);
      socket.emit('error', { message: 'Bulk subscription failed' });
    }
  }

  handlePortfolioSubscription(socket, data) {
    try {
      const { userId } = data;

      // This would typically fetch user's portfolio from database
      // For now, we'll subscribe to popular symbols as an example
      this.handleBulkSubscription(socket, {
        symbols: this.popularSymbols,
        replace: true
      });

      socket.emit('portfolio_subscription_confirmed', {
        userId: userId,
        symbols: this.popularSymbols,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} subscribed to portfolio for user: ${userId}`);
    } catch (error) {
      logger.error('Error handling portfolio subscription:', error);
      socket.emit('error', { message: 'Portfolio subscription failed' });
    }
  }

  handlePopularSubscription(socket) {
    this.handleBulkSubscription(socket, {
      symbols: this.popularSymbols,
      replace: false
    });

    socket.emit('popular_subscription_confirmed', {
      symbols: this.popularSymbols,
      timestamp: Date.now()
    });

    logger.debug(`Client ${socket.id} subscribed to popular assets`);
  }

  handleDisconnection(socketId) {
    const client = this.connectedClients.get(socketId);
    if (client) {
      // Clean up subscriptions
      client.subscribedSymbols.forEach(symbol => {
        const stillSubscribed = Array.from(this.connectedClients.values())
          .filter(c => c.socket.id !== socketId)
          .some(c => c.subscribedSymbols.has(symbol));

        if (!stillSubscribed) {
          this.subscribedSymbols.delete(symbol);
        }
      });

      this.connectedClients.delete(socketId);
    }
  }

  async sendInitialData(socket) {
    try {
      // Send popular assets data immediately upon connection
      const popularAssets = await this.getPopularAssetsData();
      socket.emit('initial_data', {
        popular_assets: popularAssets,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error('Error sending initial data:', error);
    }
  }

  async getPopularAssetsData() {
    try {
      const assets = {};

      await Promise.allSettled(
        this.popularSymbols.map(async (symbol) => {
          try {
            const [asset, quote, bars] = await Promise.all([
              alpacaService.getAsset(symbol),
              alpacaService.getLatestQuote(symbol),
              alpacaService.getBars(symbol, '1Day', null, null, 2)
            ]);

            let changePercent = 0;
            let change = 0;
            const currentPrice = quote.ap || quote.bp || 0;

            if (bars.length >= 2 && currentPrice > 0) {
              const previousClose = parseFloat(bars[bars.length - 2].c);
              change = currentPrice - previousClose;
              changePercent = (change / previousClose) * 100;
            }

            assets[symbol] = {
              symbol: asset.symbol,
              name: asset.name,
              logo: asset.logo,
              currentPrice: parseFloat(currentPrice.toFixed(2)),
              change: parseFloat(change.toFixed(2)),
              changePercent: parseFloat(changePercent.toFixed(2)),
              volume: bars.length > 0 ? parseInt(bars[bars.length - 1].v || 0) : 0,
              high: bars.length > 0 ? parseFloat(bars[bars.length - 1].h || 0) : 0,
              low: bars.length > 0 ? parseFloat(bars[bars.length - 1].l || 0) : 0,
              lastUpdated: quote.t,
              isProfit: changePercent >= 0
            };
          } catch (error) {
            logger.warn(`Failed to get data for popular asset ${symbol}:`, error.message);
          }
        })
      );

      return assets;
    } catch (error) {
      logger.error('Error getting popular assets data:', error);
      return {};
    }
  }

  startPriceUpdates() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }

    this.priceUpdateInterval = setInterval(async () => {
      await this.broadcastPriceUpdates();
    }, this.updateIntervalMs);

    logger.info(`Started price updates with ${this.updateIntervalMs}ms interval`);
  }

  async broadcastPriceUpdates() {
    try {
      if (this.subscribedSymbols.size === 0) {
        return;
      }

      const symbols = Array.from(this.subscribedSymbols);
      const updates = {};
      const timestamp = Date.now();

      // Fetch updates for all subscribed symbols
      await Promise.allSettled(
        symbols.map(async (symbol) => {
          try {
            const [quote, bars] = await Promise.race([
              Promise.all([
                alpacaService.getLatestQuote(symbol),
                alpacaService.getBars(symbol, '1Day', null, null, 2)
              ]),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 3000)
              )
            ]);

            let changePercent = 0;
            let change = 0;
            const currentPrice = quote.ap || quote.bp || 0;

            if (bars.length >= 2 && currentPrice > 0) {
              const previousClose = parseFloat(bars[bars.length - 2].c);
              change = currentPrice - previousClose;
              changePercent = (change / previousClose) * 100;
            }

            updates[symbol] = {
              symbol,
              currentPrice: parseFloat(currentPrice.toFixed(2)),
              change: parseFloat(change.toFixed(2)),
              changePercent: parseFloat(changePercent.toFixed(2)),
              volume: bars.length > 0 ? parseInt(bars[bars.length - 1].v || 0) : 0,
              high: bars.length > 0 ? parseFloat(bars[bars.length - 1].h || 0) : 0,
              low: bars.length > 0 ? parseFloat(bars[bars.length - 1].l || 0) : 0,
              lastUpdated: quote.t,
              isProfit: changePercent >= 0,
              timestamp
            };
          } catch (error) {
            logger.debug(`Failed to get update for ${symbol}:`, error.message);
          }
        })
      );

      // Broadcast to connected clients
      this.connectedClients.forEach((client, socketId) => {
        const relevantUpdates = {};
        client.subscribedSymbols.forEach(symbol => {
          if (updates[symbol]) {
            relevantUpdates[symbol] = updates[symbol];
          }
        });

        if (Object.keys(relevantUpdates).length > 0) {
          client.socket.emit('price_update', {
            data: relevantUpdates,
            timestamp
          });
        }
      });

      logger.debug(`Broadcasted ${Object.keys(updates).length} price updates to ${this.connectedClients.size} clients`);
    } catch (error) {
      logger.error('Error broadcasting price updates:', error);
    }
  }

  updateClientActivity(socketId) {
    const client = this.connectedClients.get(socketId);
    if (client) {
      client.lastActivity = new Date();
    }
  }

  // Broadcast a single asset update
  broadcastAssetUpdate(symbol, marketData) {
    const update = {
      [symbol]: {
        symbol,
        ...marketData,
        timestamp: Date.now()
      }
    };

    this.connectedClients.forEach((client) => {
      if (client.subscribedSymbols.has(symbol)) {
        client.socket.emit('price_update', {
          data: update,
          timestamp: Date.now()
        });
      }
    });
  }

  // Get connection statistics
  getStats() {
    return {
      connectedClients: this.connectedClients.size,
      subscribedSymbols: this.subscribedSymbols.size,
      updateInterval: this.updateIntervalMs,
      uptime: Date.now() - (this.server ? this.server.startTime : Date.now())
    };
  }

  // Update the update interval
  setUpdateInterval(intervalMs) {
    this.updateIntervalMs = Math.max(1000, intervalMs); // Min 1 second
    this.startPriceUpdates();
    logger.info(`Update interval changed to ${this.updateIntervalMs}ms`);
  }

  // Graceful shutdown
  shutdown() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }

    if (this.io) {
      this.io.close();
    }

    logger.info('WebSocket service shut down');
  }
}

module.exports = new WebSocketService();