const { SupportTicket, SupportTicketMessage, User } = require('../models');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const createTicket = async (req, res) => {
  try {
    const { category, subject, description, priority = 'medium', attachments = [] } = req.body;

    // Validate category
    const validCategories = [
      'account_issues', 'trading_issues', 'deposit_withdrawal', 'technical_support',
      'kyc_verification', 'general_inquiry', 'complaint', 'feature_request', 'bug_report'
    ];

    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category',
        validCategories
      });
    }

    // Auto-prioritize certain categories
    let finalPriority = priority;
    if (['account_issues', 'trading_issues', 'deposit_withdrawal'].includes(category)) {
      finalPriority = priority === 'low' ? 'medium' : priority;
    }

    if (category === 'complaint') {
      finalPriority = 'high';
    }

    const ticket = await SupportTicket.create({
      user_id: req.user.id,
      category,
      subject,
      description,
      priority: finalPriority,
      metadata: {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        submissionTime: new Date().toISOString(),
        attachments
      },
      tags: [category, finalPriority]
    });

    // Create initial message
    await ticket.addMessage({
      sender_id: req.user.id,
      sender_type: 'user',
      message: description,
      attachments
    });

    const user = await User.findByPk(req.user.id);

    // Send confirmation email
    try {
      await emailService.sendSupportTicketEmail(user, {
        ticketId: ticket.ticket_id,
        subject,
        category,
        priority: finalPriority,
        status: 'created'
      });
    } catch (emailError) {
      logger.warn('Failed to send support ticket confirmation email:', emailError);
    }

    // Notify support team (if implemented)
    await notificationService.queueNotification(null, 'support_ticket_created', {
      ticketId: ticket.ticket_id,
      category,
      priority: finalPriority,
      userId: req.user.id,
      userEmail: user.email
    });

    logger.info(`Support ticket created: ${ticket.ticket_id} by user ${req.user.id}`);

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      ticket: {
        id: ticket.id,
        ticketId: ticket.ticket_id,
        category,
        subject,
        priority: finalPriority,
        status: ticket.status,
        createdAt: ticket.created_at
      }
    });
  } catch (error) {
    logger.error('Create support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create support ticket'
    });
  }
};

const getTickets = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category, search } = req.query;
    const offset = (page - 1) * limit;

    const whereClause = { user_id: req.user.id };
    if (status) whereClause.status = status;
    if (category) whereClause.category = category;

    if (search) {
      whereClause[SupportTicket.sequelize.Sequelize.Op.or] = [
        { subject: { [SupportTicket.sequelize.Sequelize.Op.iLike]: `%${search}%` } },
        { ticket_id: { [SupportTicket.sequelize.Sequelize.Op.iLike]: `%${search}%` } },
        { description: { [SupportTicket.sequelize.Sequelize.Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: tickets } = await SupportTicket.findAndCountAll({
      where: whereClause,
      include: [{
        model: SupportTicketMessage,
        as: 'messages',
        order: [['created_at', 'ASC']],
        limit: 1 // Get only the first message for preview
      }],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const formattedTickets = tickets.map(ticket => ({
      id: ticket.id,
      ticketId: ticket.ticket_id,
      category: ticket.category,
      subject: ticket.subject,
      priority: ticket.priority,
      status: ticket.status,
      messageCount: ticket.messages ? ticket.messages.length : 0,
      lastMessage: ticket.messages && ticket.messages.length > 0
        ? ticket.messages[0].message.substring(0, 150) + '...'
        : ticket.description.substring(0, 150) + '...',
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      resolvedAt: ticket.resolved_at
    }));

    // Get ticket statistics
    const stats = await SupportTicket.findAll({
      where: { user_id: req.user.id },
      attributes: [
        'status',
        [SupportTicket.sequelize.fn('COUNT', SupportTicket.sequelize.col('status')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    const statusCounts = {
      open: 0,
      in_progress: 0,
      waiting_for_customer: 0,
      resolved: 0,
      closed: 0
    };

    stats.forEach(stat => {
      statusCounts[stat.status] = parseInt(stat.count);
    });

    res.json({
      success: true,
      tickets: formattedTickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      },
      statistics: statusCounts,
      filters: { status, category, search }
    });
  } catch (error) {
    logger.error('Get support tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support tickets'
    });
  }
};

const getTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await SupportTicket.findOne({
      where: {
        ticket_id: ticketId,
        user_id: req.user.id
      },
      include: [{
        model: SupportTicketMessage,
        as: 'messages',
        include: [{
          model: User,
          attributes: ['id', 'first_name', 'last_name', 'email'],
          required: false
        }],
        order: [['created_at', 'ASC']]
      }]
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    const formattedMessages = ticket.messages.map(msg => ({
      id: msg.id,
      senderId: msg.sender_id,
      senderType: msg.sender_type,
      senderName: msg.User ? `${msg.User.first_name} ${msg.User.last_name}` : 'Support Team',
      message: msg.message,
      attachments: msg.attachments,
      isInternal: msg.is_internal,
      createdAt: msg.created_at
    }));

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketId: ticket.ticket_id,
        category: ticket.category,
        subject: ticket.subject,
        description: ticket.description,
        priority: ticket.priority,
        status: ticket.status,
        assignedTo: ticket.assigned_to,
        resolvedBy: ticket.resolved_by,
        resolvedAt: ticket.resolved_at,
        resolutionNotes: ticket.resolution_notes,
        satisfactionRating: ticket.satisfaction_rating,
        feedback: ticket.feedback,
        metadata: ticket.metadata,
        tags: ticket.tags,
        messages: formattedMessages,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at
      }
    });
  } catch (error) {
    logger.error('Get support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support ticket'
    });
  }
};

const addMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, attachments = [] } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    const ticket = await SupportTicket.findOne({
      where: {
        ticket_id: ticketId,
        user_id: req.user.id
      }
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add messages to a closed ticket'
      });
    }

    const ticketMessage = await ticket.addMessage({
      sender_id: req.user.id,
      sender_type: 'user',
      message,
      attachments
    });

    const user = await User.findByPk(req.user.id);

    // Send email notification to support team
    try {
      await emailService.sendSupportTicketEmail(user, {
        ticketId: ticket.ticket_id,
        subject: ticket.subject,
        message,
        status: 'reply_added',
        type: 'customer_reply'
      });
    } catch (emailError) {
      logger.warn('Failed to send support ticket reply email:', emailError);
    }

    logger.info(`Message added to ticket ${ticketId} by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Message added successfully',
      ticketMessage: {
        id: ticketMessage.id,
        message: ticketMessage.message,
        attachments: ticketMessage.attachments,
        createdAt: ticketMessage.created_at
      },
      ticketStatus: ticket.status
    });
  } catch (error) {
    logger.error('Add message to support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add message to support ticket'
    });
  }
};

const closeTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { feedback, satisfactionRating } = req.body;

    const ticket = await SupportTicket.findOne({
      where: {
        ticket_id: ticketId,
        user_id: req.user.id
      }
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (!['resolved'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only resolved tickets can be closed by customers'
      });
    }

    // Update ticket
    ticket.status = 'closed';
    ticket.closed_at = new Date();

    if (feedback) ticket.feedback = feedback;
    if (satisfactionRating) {
      if (satisfactionRating < 1 || satisfactionRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Satisfaction rating must be between 1 and 5'
        });
      }
      ticket.satisfaction_rating = satisfactionRating;
    }

    await ticket.save();

    // Add system message
    await ticket.addMessage({
      sender_id: req.user.id,
      sender_type: 'system',
      message: `Ticket closed by customer${feedback ? ` with feedback: ${feedback}` : ''}${satisfactionRating ? ` (Rating: ${satisfactionRating}/5)` : ''}`,
      is_internal: true
    });

    logger.info(`Support ticket ${ticketId} closed by user ${req.user.id}`, {
      satisfactionRating,
      hasFeedback: !!feedback
    });

    res.json({
      success: true,
      message: 'Support ticket closed successfully',
      ticket: {
        ticketId: ticket.ticket_id,
        status: ticket.status,
        closedAt: ticket.closed_at,
        satisfactionRating: ticket.satisfaction_rating
      }
    });
  } catch (error) {
    logger.error('Close support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close support ticket'
    });
  }
};

const reopenTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { reason } = req.body;

    const ticket = await SupportTicket.findOne({
      where: {
        ticket_id: ticketId,
        user_id: req.user.id
      }
    });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Support ticket not found'
      });
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only resolved or closed tickets can be reopened'
      });
    }

    // Check if ticket was closed more than 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (ticket.closed_at && ticket.closed_at < thirtyDaysAgo) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reopen tickets closed more than 30 days ago. Please create a new ticket.'
      });
    }

    // Reopen ticket
    ticket.status = 'open';
    ticket.closed_at = null;
    ticket.resolved_at = null;
    ticket.resolved_by = null;
    ticket.resolution_notes = null;
    await ticket.save();

    // Add reopening message
    await ticket.addMessage({
      sender_id: req.user.id,
      sender_type: 'user',
      message: `Ticket reopened by customer${reason ? `: ${reason}` : ''}`,
      is_internal: false
    });

    const user = await User.findByPk(req.user.id);

    // Send notification to support team
    try {
      await emailService.sendSupportTicketEmail(user, {
        ticketId: ticket.ticket_id,
        subject: ticket.subject,
        message: reason || 'Ticket reopened by customer',
        status: 'reopened',
        type: 'ticket_reopened'
      });
    } catch (emailError) {
      logger.warn('Failed to send ticket reopened email:', emailError);
    }

    logger.info(`Support ticket ${ticketId} reopened by user ${req.user.id}`, { reason });

    res.json({
      success: true,
      message: 'Support ticket reopened successfully',
      ticket: {
        ticketId: ticket.ticket_id,
        status: ticket.status,
        reopenedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Reopen support ticket error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reopen support ticket'
    });
  }
};

const getSupportCategories = async (req, res) => {
  try {
    const categories = [
      {
        id: 'account_issues',
        name: 'Account Issues',
        description: 'Login problems, account verification, password reset',
        priority: 'medium',
        estimatedResponseTime: '2-4 hours'
      },
      {
        id: 'trading_issues',
        name: 'Trading Issues',
        description: 'Order problems, execution issues, trading platform errors',
        priority: 'high',
        estimatedResponseTime: '1-2 hours'
      },
      {
        id: 'deposit_withdrawal',
        name: 'Deposits & Withdrawals',
        description: 'MPesa deposits, withdrawal requests, transaction issues',
        priority: 'high',
        estimatedResponseTime: '1-2 hours'
      },
      {
        id: 'technical_support',
        name: 'Technical Support',
        description: 'App crashes, performance issues, browser compatibility',
        priority: 'medium',
        estimatedResponseTime: '4-8 hours'
      },
      {
        id: 'kyc_verification',
        name: 'KYC Verification',
        description: 'Identity verification, document upload issues',
        priority: 'medium',
        estimatedResponseTime: '1-3 business days'
      },
      {
        id: 'general_inquiry',
        name: 'General Inquiry',
        description: 'Questions about platform features, trading guides',
        priority: 'low',
        estimatedResponseTime: '24 hours'
      },
      {
        id: 'complaint',
        name: 'Complaint',
        description: 'Service complaints, dispute resolution',
        priority: 'high',
        estimatedResponseTime: '2-4 hours'
      },
      {
        id: 'feature_request',
        name: 'Feature Request',
        description: 'Suggestions for new features or improvements',
        priority: 'low',
        estimatedResponseTime: '3-5 business days'
      },
      {
        id: 'bug_report',
        name: 'Bug Report',
        description: 'Report software bugs or unexpected behavior',
        priority: 'medium',
        estimatedResponseTime: '24-48 hours'
      }
    ];

    res.json({
      success: true,
      categories,
      supportHours: {
        timezone: 'Africa/Nairobi',
        weekdays: '9:00 AM - 6:00 PM',
        weekends: '10:00 AM - 4:00 PM',
        holidays: 'Limited support'
      },
      contactInfo: {
        email: process.env.SUPPORT_EMAIL || 'support@tradingplatform.com',
        phone: process.env.SUPPORT_PHONE || '+254 700 000 000',
        whatsapp: process.env.SUPPORT_WHATSAPP || '+254 700 000 000'
      }
    });
  } catch (error) {
    logger.error('Get support categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support categories'
    });
  }
};

const getFAQ = async (req, res) => {
  try {
    const { category, search, limit = 20 } = req.query;

    const faqData = [
      {
        id: 1,
        category: 'account_issues',
        question: 'How do I reset my password?',
        answer: 'You can reset your password by clicking the "Forgot Password" link on the login page. Enter your email address and follow the instructions sent to your email.',
        views: 150,
        helpful: 45,
        tags: ['password', 'login', 'security']
      },
      {
        id: 2,
        category: 'account_issues',
        question: 'Why is my account locked?',
        answer: 'Your account may be locked due to multiple failed login attempts, security concerns, or pending KYC verification. Please contact support for assistance.',
        views: 89,
        helpful: 32,
        tags: ['account', 'locked', 'security']
      },
      {
        id: 3,
        category: 'trading_issues',
        question: 'Why was my order rejected?',
        answer: 'Orders can be rejected due to insufficient funds, market hours, invalid symbols, or risk management rules. Check your buying power and order details.',
        views: 234,
        helpful: 78,
        tags: ['orders', 'rejected', 'trading']
      },
      {
        id: 4,
        category: 'trading_issues',
        question: 'What are the trading hours?',
        answer: 'US markets are open Monday to Friday, 9:30 AM to 4:00 PM EST. Pre-market trading is available from 4:00 AM to 9:30 AM EST.',
        views: 456,
        helpful: 123,
        tags: ['hours', 'market', 'trading']
      },
      {
        id: 5,
        category: 'deposit_withdrawal',
        question: 'How do I deposit money via MPesa?',
        answer: 'Go to your wallet, click "Deposit", enter the amount and your MPesa number. You\'ll receive an STK push to complete the payment.',
        views: 678,
        helpful: 234,
        tags: ['deposit', 'mpesa', 'wallet']
      },
      {
        id: 6,
        category: 'deposit_withdrawal',
        question: 'How long do deposits take?',
        answer: 'MPesa deposits are usually instant. Bank transfers may take 1-3 business days. You\'ll receive a confirmation email once processed.',
        views: 345,
        helpful: 156,
        tags: ['deposit', 'time', 'processing']
      },
      {
        id: 7,
        category: 'technical_support',
        question: 'Why is the app running slowly?',
        answer: 'Slow performance can be due to poor internet connection, device memory, or app cache. Try refreshing the app or clearing your browser cache.',
        views: 123,
        helpful: 45,
        tags: ['performance', 'slow', 'technical']
      },
      {
        id: 8,
        category: 'kyc_verification',
        question: 'What documents do I need for KYC?',
        answer: 'You need a valid government ID (National ID, Passport, or Driver\'s License) and proof of address (utility bill or bank statement).',
        views: 567,
        helpful: 201,
        tags: ['kyc', 'documents', 'verification']
      },
      {
        id: 9,
        category: 'general_inquiry',
        question: 'What fees do you charge?',
        answer: 'We charge competitive commission rates starting from $0.5 per trade. Currency conversion fees apply for KES/USD transactions. Check our fee schedule for details.',
        views: 789,
        helpful: 298,
        tags: ['fees', 'commission', 'pricing']
      },
      {
        id: 10,
        category: 'general_inquiry',
        question: 'Is my money safe with you?',
        answer: 'Yes, your funds are held by our regulated broker partner Alpaca Markets. We use bank-level security and encryption to protect your data and money.',
        views: 456,
        helpful: 187,
        tags: ['safety', 'security', 'regulation']
      }
    ];

    let filteredFAQs = faqData;

    if (category) {
      filteredFAQs = filteredFAQs.filter(faq => faq.category === category);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      filteredFAQs = filteredFAQs.filter(faq =>
        faq.question.toLowerCase().includes(searchLower) ||
        faq.answer.toLowerCase().includes(searchLower) ||
        faq.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    const limitedFAQs = filteredFAQs.slice(0, parseInt(limit));

    // Get popular FAQs (top 5 by views)
    const popularFAQs = [...faqData]
      .sort((a, b) => b.views - a.views)
      .slice(0, 5)
      .map(faq => ({
        id: faq.id,
        question: faq.question,
        views: faq.views
      }));

    res.json({
      success: true,
      faqs: limitedFAQs,
      popular: popularFAQs,
      count: limitedFAQs.length,
      totalCount: filteredFAQs.length,
      filters: { category, search, limit: parseInt(limit) }
    });
  } catch (error) {
    logger.error('Get FAQ error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch FAQ'
    });
  }
};

const markFAQHelpful = async (req, res) => {
  try {
    const { faqId } = req.params;
    const { helpful } = req.body;

    // In a real implementation, you'd update the FAQ in the database
    // For now, we'll just return success
    logger.info(`FAQ ${faqId} marked as ${helpful ? 'helpful' : 'not helpful'} by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Thank you for your feedback!'
    });
  } catch (error) {
    logger.error('Mark FAQ helpful error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record feedback'
    });
  }
};

module.exports = {
  createTicket,
  getTickets,
  getTicket,
  addMessage,
  closeTicket,
  reopenTicket,
  getSupportCategories,
  getFAQ,
  markFAQHelpful
};