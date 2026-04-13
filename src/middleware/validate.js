const { body, query, param, validationResult } = require('express-validator');

// Middleware to check results
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array().map(e => e.msg) });
  }
  next();
};

// ── Auth validators ──────────────────────────────────────────────────────────
const loginRules = [
  body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password required'),
];

const changePasswordRules = [
  body('current_password').notEmpty().withMessage('Current password required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
];

// ── Student validators ───────────────────────────────────────────────────────
const studentRules = [
  body('name').trim().notEmpty().withMessage('Student name required').isLength({ max: 100 }),
  body('phone').trim().notEmpty().withMessage('Phone required').matches(/^[0-9+\-\s]{7,20}$/),
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('date_of_birth').optional({ nullable: true }).isISO8601().withMessage('Invalid date of birth'),
  body('admission_date').optional({ nullable: true }).isISO8601(),
];

// ── Fee validators ───────────────────────────────────────────────────────────
const feeRules = [
  body('student_id').isInt({ min: 1 }).withMessage('Valid student_id required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount required'),
  body('payment_mode').optional().isIn(['cash', 'online', 'cheque', 'upi', 'bank_transfer']),
  body('fee_type').optional().isIn(['tuition', 'admission', 'exam', 'material', 'other']),
  body('status').optional().isIn(['paid', 'pending', 'partial', 'waived']),
  body('payment_date').optional({ nullable: true }).isISO8601(),
];

// ── Exam validators ──────────────────────────────────────────────────────────
const examRules = [
  body('title').trim().notEmpty().withMessage('Exam title required').isLength({ max: 200 }),
  body('total_marks').isInt({ min: 1 }).withMessage('Total marks required'),
  body('exam_type').optional().isIn(['unit_test', 'monthly', 'quarterly', 'half_yearly', 'annual', 'mock', 'practice']),
  body('exam_date').optional({ nullable: true }).isISO8601(),
];

// ── Notice validators ────────────────────────────────────────────────────────
const noticeRules = [
  body('title').trim().notEmpty().withMessage('Title required').isLength({ max: 200 }),
  body('priority').optional().isIn(['normal', 'important', 'urgent']),
  body('target_role').optional().isIn(['all', 'faculty', 'student', 'parent']),
];

// ── Enquiry validators ───────────────────────────────────────────────────────
const enquiryRules = [
  body('name').trim().notEmpty().withMessage('Name required'),
  body('phone').trim().notEmpty().withMessage('Phone required'),
  body('source').optional().isIn(['walk-in', 'phone', 'website', 'social_media', 'referral', 'other']),
];

// ── Expense validators ───────────────────────────────────────────────────────
const expenseRules = [
  body('title').trim().notEmpty().withMessage('Title required'),
  body('amount').isFloat({ min: 0 }).withMessage('Valid amount required'),
  body('category').optional().isIn(['rent', 'electricity', 'internet', 'salary', 'stationery', 'maintenance', 'marketing', 'software', 'other']),
  body('expense_date').optional({ nullable: true }).isISO8601(),
];

// ── Revenue report validators ────────────────────────────────────────────────
const revenueReportRules = [
  query('from_date').notEmpty().isISO8601().withMessage('from_date is required (YYYY-MM-DD)'),
  query('to_date').notEmpty().isISO8601().withMessage('to_date is required (YYYY-MM-DD)'),
];

module.exports = {
  validate,
  loginRules, changePasswordRules,
  studentRules, feeRules, examRules,
  noticeRules, enquiryRules, expenseRules,
  revenueReportRules,
};
