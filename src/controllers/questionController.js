const Question = require('../models/Question');
const User = require('../models/User');
const { validationResult } = require('express-validator');

const questionController = {
  // Get all active questions
  getQuestions: async (req, res) => {
    try {
      const { category = 'financial_assessment', questionType } = req.query;

      const whereCondition = {
        is_active: true,
        category
      };

      // Add question type filter if provided
      if (questionType) {
        whereCondition.question_type = questionType;
      }

      const questions = await Question.findAll({
        where: whereCondition,
        order: [['order', 'ASC'], ['created_at', 'ASC']],
        attributes: ['id', 'question', 'question_type', 'options', 'category', 'is_required', 'order']
      });

      // Transform response to use camelCase for frontend
      const transformedQuestions = questions.map(q => ({
        id: q.id,
        question: q.question,
        questionType: q.question_type,
        options: q.options,
        category: q.category,
        isRequired: q.is_required,
        order: q.order
      }));

      res.status(200).json({
        success: true,
        data: {
          questions: transformedQuestions,
          totalQuestions: transformedQuestions.length,
          filters: {
            category,
            questionType: questionType || 'all'
          }
        }
      });
    } catch (error) {
      console.error('Error fetching questions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch questions',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  },

  // Submit quiz answers
  submitQuiz: async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { registrationId, answers } = req.body;

      // Verify registration exists
      const user = await User.findByPk(registrationId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Registration not found'
        });
      }

      // Validate answers format
      if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Answers must be a non-empty array'
        });
      }

      // Get all required questions
      const questionIds = answers.map(a => a.questionId);
      const questions = await Question.findAll({
        where: {
          id: questionIds,
          is_active: true
        }
      });

      if (questions.length !== questionIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more invalid question IDs provided'
        });
      }

      // Check if all required questions are answered
      const requiredQuestions = questions.filter(q => q.is_required);
      const answeredQuestionIds = answers.map(a => a.questionId);
      const missingRequired = requiredQuestions.filter(q => !answeredQuestionIds.includes(q.id));

      if (missingRequired.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Missing answers for required questions',
          missingQuestions: missingRequired.map(q => ({ id: q.id, question: q.question }))
        });
      }

      // Store quiz answers in user profile
      const quizAnswers = answers.map(answer => ({
        questionId: answer.questionId,
        question: questions.find(q => q.id === answer.questionId)?.question,
        answer: answer.answer,
        answeredAt: new Date()
      }));

      await user.update({
        quizAnswers: quizAnswers,
        quizCompletedAt: new Date(),
        registrationStatus: 'quiz_completed'
      });

      res.status(200).json({
        success: true,
        message: 'Quiz submitted successfully',
        data: {
          registrationId,
          answersCount: answers.length,
          status: 'quiz_completed',
          nextStep: 'document_upload'
        }
      });

    } catch (error) {
      console.error('Error submitting quiz:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit quiz',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
};

module.exports = questionController;