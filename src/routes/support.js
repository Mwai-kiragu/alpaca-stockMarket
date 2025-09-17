const express = require('express');
const {
  createTicket,
  getTickets,
  getTicket,
  addMessage,
  closeTicket,
  reopenTicket,
  getSupportCategories,
  getFAQ,
  markFAQHelpful
} = require('../controllers/supportController');
const { auth, authorize } = require('../middleware/auth');
const { supportTicketValidation, paginationValidation } = require('../middleware/validation');

const router = express.Router();

// Customer support endpoints
router.post('/tickets', auth, supportTicketValidation, createTicket);
router.get('/tickets', auth, paginationValidation, getTickets);
router.get('/tickets/:ticketId', auth, getTicket);
router.post('/tickets/:ticketId/messages', auth, addMessage);
router.put('/tickets/:ticketId/close', auth, closeTicket);
router.put('/tickets/:ticketId/reopen', auth, reopenTicket);

// Support information endpoints
router.get('/categories', getSupportCategories);
router.get('/faq', getFAQ);
router.post('/faq/:faqId/helpful', auth, markFAQHelpful);

// Admin endpoints (for future implementation)
router.get('/admin/tickets', auth, authorize('admin', 'support'), paginationValidation, (req, res) => {
  res.json({ success: true, message: 'Admin tickets endpoint - requires admin implementation' });
});

module.exports = router;