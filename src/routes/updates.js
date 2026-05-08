const express = require('express');
const {
  getMarketNews,
  getNewsById,
  getEducationalContent,
  getMarketInsights,
  getEconomicCalendar,
  getMarketAnalysis
} = require('../controllers/updateController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/news', auth, getMarketNews);
router.get('/news/:newsId', auth, getNewsById);
router.get('/education', auth, getEducationalContent);
router.get('/insights', auth, getMarketInsights);
router.get('/calendar', auth, getEconomicCalendar);
router.get('/analysis', auth, getMarketAnalysis);

module.exports = router;