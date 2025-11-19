const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const alpacaService = require('./alpacaService');
const redisService = require('../config/redis');
const logger = require('../utils/logger');

class WebSocketService {
  constructor() {
    this.io = null;
    this.server = null;
    this.connectedClients = new Map();
    this.subscribedSymbols = new Set();
    this.chartSubscriptions = new Map(); // symbol -> Set of socketIds
    this.priceUpdateInterval = null;
    this.chartUpdateInterval = null;
    this.updateIntervalMs = 5000; // 5 seconds for general updates
    this.chartUpdateIntervalMs = 1000; // 1 second for chart updates (faster)
    this.popularSymbols = [
      'AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
      'V', 'JPM', 'JNJ', 'WMT', 'PG', 'UNH', 'HD', 'MA', 'BAC', 'DIS'
    ];
    this.redisAdapter = null;
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

      // Set up Redis adapter for load balancer compatibility
      this.setupRedisAdapter();

      this.setupEventHandlers();
      this.startPriceUpdates();
      this.startChartUpdates();

      logger.info('WebSocket service initialized successfully');
      return this.io;
    } catch (error) {
      logger.error('Failed to initialize WebSocket service:', error);
      throw error;
    }
  }

  setupRedisAdapter() {
    try {
      // Initialize Redis if not already initialized
      if (!redisService.isConnected) {
        redisService.initialize();
      }

      const pubClient = redisService.getPublisher();
      const subClient = redisService.getSubscriber();

      // Create and set Redis adapter
      this.redisAdapter = createAdapter(pubClient, subClient);
      this.io.adapter(this.redisAdapter);

      logger.info('Socket.IO Redis adapter configured for load balancer support');
    } catch (error) {
      logger.warn('Failed to setup Redis adapter, continuing without load balancer support:', error);
      // Continue without Redis adapter - will work but only on single instance
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
        lastActivity: new Date(),
        userId: null
      });

      // Handle user authentication
      socket.on('authenticate', (data) => {
        this.handleAuthentication(socket, data);
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

      // Handle chart subscription for real-time updates
      socket.on('subscribe_chart', (data) => {
        this.handleChartSubscription(socket, data);
      });

      // Handle chart unsubscription
      socket.on('unsubscribe_chart', (data) => {
        this.handleChartUnsubscription(socket, data);
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

  handleAuthentication(socket, data) {
    try {
      const { userId } = data;

      if (!userId) {
        socket.emit('authentication_error', { message: 'User ID required' });
        return;
      }

      // Update client info
      const client = this.connectedClients.get(socket.id);
      if (client) {
        client.userId = userId;
        // Join user to their personal room for targeted notifications
        this.joinUserRoom(socket, userId);
      }

      socket.emit('authenticated', {
        userId,
        timestamp: Date.now()
      });

      logger.info(`Socket ${socket.id} authenticated for user ${userId}`);
      this.updateClientActivity(socket.id);
    } catch (error) {
      logger.error('Error handling authentication:', error);
      socket.emit('authentication_error', { message: 'Authentication failed' });
    }
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

  handleChartSubscription(socket, data) {
    try {
      const { symbol, timeframe = '1Min' } = data;

      if (!symbol) {
        socket.emit('error', { message: 'Symbol is required for chart subscription' });
        return;
      }

      const upperSymbol = symbol.toUpperCase();

      // Add to chart subscriptions
      if (!this.chartSubscriptions.has(upperSymbol)) {
        this.chartSubscriptions.set(upperSymbol, new Set());
      }
      this.chartSubscriptions.get(upperSymbol).add(socket.id);

      // Also add to general subscriptions
      const client = this.connectedClients.get(socket.id);
      if (client) {
        client.subscribedSymbols.add(upperSymbol);
        this.subscribedSymbols.add(upperSymbol);
      }

      socket.emit('chart_subscription_confirmed', {
        symbol: upperSymbol,
        timeframe,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} subscribed to chart for ${upperSymbol} (${timeframe})`);
      this.updateClientActivity(socket.id);

      // Send initial chart data
      this.sendInitialChartData(socket, upperSymbol, timeframe);
    } catch (error) {
      logger.error('Error handling chart subscription:', error);
      socket.emit('error', { message: 'Chart subscription failed' });
    }
  }

  handleChartUnsubscription(socket, data) {
    try {
      const { symbol } = data;

      if (!symbol) return;

      const upperSymbol = symbol.toUpperCase();

      // Remove from chart subscriptions
      if (this.chartSubscriptions.has(upperSymbol)) {
        this.chartSubscriptions.get(upperSymbol).delete(socket.id);

        // Clean up empty sets
        if (this.chartSubscriptions.get(upperSymbol).size === 0) {
          this.chartSubscriptions.delete(upperSymbol);
        }
      }

      socket.emit('chart_unsubscription_confirmed', {
        symbol: upperSymbol,
        timestamp: Date.now()
      });

      logger.debug(`Client ${socket.id} unsubscribed from chart for ${upperSymbol}`);
    } catch (error) {
      logger.error('Error handling chart unsubscription:', error);
    }
  }

  async sendInitialChartData(socket, symbol, timeframe) {
    try {
      const bars = await alpacaService.getBars(symbol, timeframe, null, null, 50);

      const chartData = bars.map(bar => ({
        timestamp: bar.t,
        open: parseFloat(bar.o),
        high: parseFloat(bar.h),
        low: parseFloat(bar.l),
        close: parseFloat(bar.c),
        volume: parseInt(bar.v)
      }));

      socket.emit('chart_initial_data', {
        symbol,
        timeframe,
        data: chartData,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error sending initial chart data for ${symbol}:`, error);
    }
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

      // Clean up chart subscriptions
      this.chartSubscriptions.forEach((socketIds, symbol) => {
        socketIds.delete(socketId);
        if (socketIds.size === 0) {
          this.chartSubscriptions.delete(symbol);
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

  startChartUpdates() {
    if (this.chartUpdateInterval) {
      clearInterval(this.chartUpdateInterval);
    }

    this.chartUpdateInterval = setInterval(async () => {
      await this.broadcastChartUpdates();
    }, this.chartUpdateIntervalMs);

    logger.info(`Started chart updates with ${this.chartUpdateIntervalMs}ms interval`);
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

  async broadcastChartUpdates() {
    try {
      if (this.chartSubscriptions.size === 0) {
        return;
      }

      const timestamp = Date.now();

      // Fetch latest bar for each subscribed chart
      for (const [symbol, socketIds] of this.chartSubscriptions.entries()) {
        if (socketIds.size === 0) continue;

        try {
          // Get the latest 1-minute bar
          const bars = await alpacaService.getBars(symbol, '1Min', null, null, 1);

          if (bars && bars.length > 0) {
            const latestBar = bars[0];
            const chartUpdate = {
              symbol,
              data: {
                timestamp: latestBar.t,
                open: parseFloat(latestBar.o),
                high: parseFloat(latestBar.h),
                low: parseFloat(latestBar.l),
                close: parseFloat(latestBar.c),
                volume: parseInt(latestBar.v)
              },
              timestamp
            };

            // Emit to all clients subscribed to this chart
            socketIds.forEach(socketId => {
              const client = this.connectedClients.get(socketId);
              if (client) {
                client.socket.emit('chart_update', chartUpdate);
              }
            });
          }
        } catch (error) {
          logger.debug(`Failed to get chart update for ${symbol}:`, error.message);
        }
      }

      logger.debug(`Broadcasted chart updates for ${this.chartSubscriptions.size} symbols`);
    } catch (error) {
      logger.error('Error broadcasting chart updates:', error);
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

  /**
   * Broadcast notification to specific user across all server instances
   * @param {number} userId - User ID
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  broadcastToUser(userId, event, data) {
    try {
      const room = `user:${userId}`;
      this.io.to(room).emit(event, {
        ...data,
        timestamp: Date.now()
      });

      logger.debug(`Broadcasted ${event} to user ${userId}`);
    } catch (error) {
      logger.error(`Error broadcasting to user ${userId}:`, error);
    }
  }

  /**
   * Broadcast notification to all connected clients across all server instances
   * @param {string} event - Event name
   * @param {object} data - Event data
   */
  broadcastToAll(event, data) {
    try {
      this.io.emit(event, {
        ...data,
        timestamp: Date.now()
      });

      logger.debug(`Broadcasted ${event} to all clients`);
    } catch (error) {
      logger.error('Error broadcasting to all clients:', error);
    }
  }

  /**
   * Join user to their personal room for targeted notifications
   * @param {object} socket - Socket instance
   * @param {number} userId - User ID
   */
  joinUserRoom(socket, userId) {
    try {
      const room = `user:${userId}`;
      socket.join(room);
      logger.debug(`Socket ${socket.id} joined room ${room}`);
    } catch (error) {
      logger.error(`Error joining user room for ${userId}:`, error);
    }
  }

  /**
   * Leave user room
   * @param {object} socket - Socket instance
   * @param {number} userId - User ID
   */
  leaveUserRoom(socket, userId) {
    try {
      const room = `user:${userId}`;
      socket.leave(room);
      logger.debug(`Socket ${socket.id} left room ${room}`);
    } catch (error) {
      logger.error(`Error leaving user room for ${userId}:`, error);
    }
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

    if (this.chartUpdateInterval) {
      clearInterval(this.chartUpdateInterval);
      this.chartUpdateInterval = null;
    }

    if (this.io) {
      this.io.close();
    }

    logger.info('WebSocket service shut down');
  }
}

module.exports = new WebSocketService();