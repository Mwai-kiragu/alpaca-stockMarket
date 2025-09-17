const { SupportTicket, SupportTicketMessage, User } = require('../models');
const emailService = require('./emailService');
const logger = require('../utils/logger');

class SupportService {
  constructor() {
    this.ticketHandlers = new Map();
    this.autoResponders = new Map();
    this.escalationRules = new Map();

    this.initializeAutoResponders();
    this.initializeEscalationRules();
  }

  initializeAutoResponders() {
    // Auto-responses for common categories
    this.autoResponders.set('account_issues', {
      enabled: true,
      message: `Thank you for contacting support regarding your account.

Common account issues can often be resolved by:
• Resetting your password using the "Forgot Password" link
• Clearing your browser cache and cookies
• Checking your email for verification links

If these steps don't help, our team will review your ticket and respond within 2-4 hours.`,
      delay: 30000 // 30 seconds delay
    });

    this.autoResponders.set('trading_issues', {
      enabled: true,
      message: `We've received your trading-related inquiry.

Before our team responds, please check:
• Market hours (US markets: 9:30 AM - 4:00 PM EST, Mon-Fri)
• Your account balance and buying power
• Order status in your portfolio

Our trading support team will review your ticket and respond within 1-2 hours during market hours.`,
      delay: 60000 // 1 minute delay
    });

    this.autoResponders.set('deposit_withdrawal', {
      enabled: true,
      message: `Thank you for your deposit/withdrawal inquiry.

Important information:
• MPesa deposits are usually instant
• Bank transfers may take 1-3 business days
• Check your transaction history for status updates

Our finance team will review your ticket and respond within 1-2 hours.`,
      delay: 45000 // 45 seconds delay
    });
  }

  initializeEscalationRules() {
    // Escalation rules based on ticket age and priority
    this.escalationRules.set('high_priority', {
      timeThreshold: 2 * 60 * 60 * 1000, // 2 hours
      escalateTo: 'senior_support',
      notifyManagement: true
    });

    this.escalationRules.set('urgent_priority', {
      timeThreshold: 30 * 60 * 1000, // 30 minutes
      escalateTo: 'management',
      notifyManagement: true
    });

    this.escalationRules.set('trading_issues', {
      timeThreshold: 4 * 60 * 60 * 1000, // 4 hours during market hours
      escalateTo: 'senior_support',
      category: 'trading_issues'
    });
  }

  async processNewTicket(ticket) {
    try {
      // Send auto-response if configured
      await this.sendAutoResponse(ticket);

      // Apply intelligent routing
      await this.routeTicket(ticket);

      // Schedule escalation check
      this.scheduleEscalationCheck(ticket);

      logger.info(`New support ticket processed: ${ticket.ticket_id}`);
    } catch (error) {
      logger.error('Error processing new ticket:', error);
    }
  }

  async sendAutoResponse(ticket) {
    const autoResponder = this.autoResponders.get(ticket.category);

    if (!autoResponder || !autoResponder.enabled) {
      return;
    }

    // Delay the auto-response
    setTimeout(async () => {
      try {
        await ticket.addMessage({
          sender_id: null, // System message
          sender_type: 'system',
          message: autoResponder.message,
          is_internal: false
        });

        logger.info(`Auto-response sent for ticket ${ticket.ticket_id}`);
      } catch (error) {
        logger.error('Error sending auto-response:', error);
      }
    }, autoResponder.delay);
  }

  async routeTicket(ticket) {
    // Simple routing logic - in production, this would be more sophisticated
    let assignTo = null;

    switch (ticket.category) {
      case 'trading_issues':
        assignTo = await this.findAvailableAgent('trading_specialist');
        break;
      case 'deposit_withdrawal':
        assignTo = await this.findAvailableAgent('finance_specialist');
        break;
      case 'technical_support':
        assignTo = await this.findAvailableAgent('technical_specialist');
        break;
      case 'kyc_verification':
        assignTo = await this.findAvailableAgent('kyc_specialist');
        break;
      default:
        assignTo = await this.findAvailableAgent('general_support');
    }

    if (assignTo) {
      ticket.assigned_to = assignTo;
      ticket.status = 'in_progress';
      await ticket.save();

      logger.info(`Ticket ${ticket.ticket_id} routed to agent ${assignTo}`);
    }
  }

  async findAvailableAgent(specialization) {
    // In production, this would query a support agents table
    // For now, return null to keep tickets unassigned
    return null;
  }

  scheduleEscalationCheck(ticket) {
    const escalationRule = this.escalationRules.get(ticket.priority === 'urgent' ? 'urgent_priority' :
                                                   ticket.priority === 'high' ? 'high_priority' :
                                                   ticket.category);

    if (!escalationRule) return;

    setTimeout(async () => {
      try {
        const currentTicket = await SupportTicket.findByPk(ticket.id);

        if (currentTicket && !['resolved', 'closed'].includes(currentTicket.status)) {
          await this.escalateTicket(currentTicket, escalationRule);
        }
      } catch (error) {
        logger.error('Error in scheduled escalation check:', error);
      }
    }, escalationRule.timeThreshold);
  }

  async escalateTicket(ticket, escalationRule) {
    // Update ticket priority if needed
    if (ticket.priority === 'medium') {
      ticket.priority = 'high';
    } else if (ticket.priority === 'high') {
      ticket.priority = 'urgent';
    }

    // Add escalation note
    await ticket.addMessage({
      sender_id: null,
      sender_type: 'system',
      message: `Ticket automatically escalated due to response time threshold. Original priority: ${ticket.priority}`,
      is_internal: true
    });

    await ticket.save();

    logger.warn(`Ticket ${ticket.ticket_id} escalated to ${escalationRule.escalateTo}`);

    // Notify management if required
    if (escalationRule.notifyManagement) {
      await this.notifyManagement(ticket);
    }
  }

  async notifyManagement(ticket) {
    // In production, this would send notifications to management
    logger.warn(`Management notification required for escalated ticket: ${ticket.ticket_id}`);
  }

  async analyzeTicketSentiment(message) {
    // Simple sentiment analysis - in production, use a proper NLP service
    const negativeWords = ['angry', 'frustrated', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'disgusted'];
    const urgentWords = ['urgent', 'asap', 'immediately', 'emergency', 'critical', 'important'];

    const messageLower = message.toLowerCase();

    let sentiment = 'neutral';
    let urgency = 'normal';

    if (negativeWords.some(word => messageLower.includes(word))) {
      sentiment = 'negative';
    }

    if (urgentWords.some(word => messageLower.includes(word))) {
      urgency = 'high';
    }

    return { sentiment, urgency };
  }

  async getTicketAnalytics(timeframe = 30) {
    try {
      const startDate = new Date(Date.now() - timeframe * 24 * 60 * 60 * 1000);

      const analytics = await SupportTicket.findAll({
        where: {
          created_at: {
            [SupportTicket.sequelize.Sequelize.Op.gte]: startDate
          }
        },
        attributes: [
          'category',
          'priority',
          'status',
          [SupportTicket.sequelize.fn('COUNT', SupportTicket.sequelize.col('id')), 'count'],
          [SupportTicket.sequelize.fn('AVG',
            SupportTicket.sequelize.literal('EXTRACT(epoch FROM (COALESCE(resolved_at, NOW()) - created_at))')
          ), 'avg_resolution_time']
        ],
        group: ['category', 'priority', 'status'],
        raw: true
      });

      // Calculate satisfaction ratings
      const satisfactionData = await SupportTicket.findAll({
        where: {
          created_at: {
            [SupportTicket.sequelize.Sequelize.Op.gte]: startDate
          },
          satisfaction_rating: {
            [SupportTicket.sequelize.Sequelize.Op.not]: null
          }
        },
        attributes: [
          [SupportTicket.sequelize.fn('AVG', SupportTicket.sequelize.col('satisfaction_rating')), 'avg_rating'],
          [SupportTicket.sequelize.fn('COUNT', SupportTicket.sequelize.col('satisfaction_rating')), 'rating_count']
        ],
        raw: true
      });

      return {
        timeframe,
        ticketAnalytics: analytics,
        satisfaction: satisfactionData[0] || { avg_rating: 0, rating_count: 0 },
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error getting ticket analytics:', error);
      throw error;
    }
  }

  async getPopularIssues(limit = 10) {
    try {
      // Group similar tickets by keywords in subject/description
      const tickets = await SupportTicket.findAll({
        attributes: ['subject', 'description', 'category'],
        where: {
          created_at: {
            [SupportTicket.sequelize.Sequelize.Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        },
        raw: true
      });

      // Simple keyword extraction and grouping
      const issueGroups = {};

      tickets.forEach(ticket => {
        const text = `${ticket.subject} ${ticket.description}`.toLowerCase();
        const keywords = text.match(/\b\w{4,}\b/g) || [];

        keywords.forEach(keyword => {
          if (!issueGroups[keyword]) {
            issueGroups[keyword] = {
              keyword,
              count: 0,
              category: ticket.category
            };
          }
          issueGroups[keyword].count++;
        });
      });

      const popularIssues = Object.values(issueGroups)
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return popularIssues;
    } catch (error) {
      logger.error('Error getting popular issues:', error);
      return [];
    }
  }

  async suggestRelatedFAQ(ticketText) {
    // Simple FAQ matching based on keywords
    const keywords = ticketText.toLowerCase().match(/\b\w{4,}\b/g) || [];

    const faqSuggestions = [
      {
        id: 1,
        question: 'How do I reset my password?',
        keywords: ['password', 'reset', 'login', 'access'],
        category: 'account_issues'
      },
      {
        id: 3,
        question: 'Why was my order rejected?',
        keywords: ['order', 'rejected', 'trade', 'buy', 'sell'],
        category: 'trading_issues'
      },
      {
        id: 5,
        question: 'How do I deposit money via MPesa?',
        keywords: ['deposit', 'mpesa', 'money', 'fund'],
        category: 'deposit_withdrawal'
      }
    ];

    const suggestions = faqSuggestions.filter(faq => {
      const matchCount = keywords.filter(keyword =>
        faq.keywords.some(faqKeyword => keyword.includes(faqKeyword))
      ).length;
      return matchCount > 0;
    }).slice(0, 3);

    return suggestions;
  }

  async generateTicketSummary(ticketId) {
    try {
      const ticket = await SupportTicket.findOne({
        where: { ticket_id: ticketId },
        include: [{
          model: SupportTicketMessage,
          as: 'messages',
          include: [{
            model: User,
            attributes: ['first_name', 'last_name']
          }],
          order: [['created_at', 'ASC']]
        }]
      });

      if (!ticket) {
        throw new Error('Ticket not found');
      }

      const summary = {
        ticketId: ticket.ticket_id,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        createdAt: ticket.created_at,
        resolvedAt: ticket.resolved_at,
        messageCount: ticket.messages.length,
        participants: [...new Set(ticket.messages.map(msg =>
          msg.User ? `${msg.User.first_name} ${msg.User.last_name}` : 'Support Team'
        ))],
        timeline: ticket.messages.map(msg => ({
          timestamp: msg.created_at,
          sender: msg.sender_type,
          messagePreview: msg.message.substring(0, 100) + (msg.message.length > 100 ? '...' : '')
        })),
        resolutionTime: ticket.resolved_at ?
          Math.round((new Date(ticket.resolved_at) - new Date(ticket.created_at)) / (1000 * 60 * 60)) : null,
        satisfactionRating: ticket.satisfaction_rating
      };

      return summary;
    } catch (error) {
      logger.error('Error generating ticket summary:', error);
      throw error;
    }
  }
}

module.exports = new SupportService();