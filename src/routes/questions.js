const express = require('express');
const { body } = require('express-validator');
const questionController = require('../controllers/questionController');

const router = express.Router();

// Validation middleware for quiz submission
const validateQuizSubmission = [
  body('registrationId')
    .isUUID()
    .withMessage('Valid registration ID is required'),
  body('answers')
    .isArray({ min: 1 })
    .withMessage('Answers must be a non-empty array'),
  body('answers.*.questionId')
    .isInt({ min: 1 })
    .withMessage('Question ID must be a positive integer'),
  body('answers.*.answer')
    .notEmpty()
    .withMessage('Answer cannot be empty')
];

// Routes
router.get('/questions', questionController.getQuestions);
router.post('/registration/quiz', validateQuizSubmission, questionController.submitQuiz);

module.exports = router;