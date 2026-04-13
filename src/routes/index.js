const express = require('express');
const multer = require('multer');
const path = require('path');

const { auth, authorize, checkLicense } = require('../middleware/auth');
const {
  validate, loginRules, changePasswordRules,
  studentRules, feeRules, examRules,
  noticeRules, enquiryRules, expenseRules, revenueReportRules,
} = require('../middleware/validate');

const authCtrl     = require('../controllers/authController');
const studentCtrl  = require('../controllers/studentController');
const mainCtrl     = require('../controllers/mainController');
const extraCtrl    = require('../controllers/extraController');
const superCtrl    = require('../controllers/superAdminController');
const parentCtrl   = require('../controllers/parentController');

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname).replace(/\s+/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const blocked = ['.exe', '.sh', '.bat', '.cmd', '.php', '.py', '.js'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext)) return cb(new Error('File type not allowed'));
    cb(null, true);
  },
});

module.exports = (loginLimiter) => {
  const router = express.Router();

  // ── Auth (public) ────────────────────────────────────────────────────────────
  router.post('/auth/login', loginLimiter, loginRules, validate, authCtrl.login);
  router.get('/auth/me', auth, authCtrl.getMe);
  router.put('/auth/change-password', auth, changePasswordRules, validate, authCtrl.changePassword);

  // ── Super Admin ──────────────────────────────────────────────────────────────
  const SA = [auth, authorize('superadmin')];
  router.get('/super/dashboard',              ...SA, superCtrl.getSuperDashboard);
  router.get('/super/orgs',                   ...SA, superCtrl.getAllOrgs);
  router.post('/super/orgs',                  ...SA, superCtrl.createOrg);
  router.get('/super/orgs/:id',               ...SA, superCtrl.getOrg);
  router.put('/super/orgs/:id',               ...SA, superCtrl.updateOrg);
  router.delete('/super/orgs/:id',            ...SA, superCtrl.deleteOrg);
  router.patch('/super/orgs/:id/toggle',      ...SA, superCtrl.toggleOrgStatus);
  router.put('/super/orgs/:org_id/license',   ...SA, superCtrl.updateLicense);
  router.post('/super/orgs/:org_id/license/renew', ...SA, superCtrl.renewLicense);
  router.get('/super/orgs/:org_id/menus',     ...SA, superCtrl.getMenuPermissions);
  router.put('/super/orgs/:org_id/menus',     ...SA, superCtrl.updateMenuPermissions);

  // ── Org-scoped middleware ────────────────────────────────────────────────────
  const OA  = [auth, checkLicense];
  const ADM = [auth, checkLicense, authorize('admin')];

  // Dashboard
  router.get('/dashboard', ...OA, extraCtrl.getDashboardStats);

  // Students
  router.get('/students',            ...OA, studentCtrl.getAll);
  router.post('/students',           ...ADM, studentRules, validate, studentCtrl.create);
  router.get('/students/:id',        ...OA, studentCtrl.getOne);
  router.put('/students/:id',        ...ADM, studentRules, validate, studentCtrl.update);
  router.delete('/students/:id',     ...ADM, studentCtrl.remove);
  // Report card PDF
  router.get('/students/:student_id/report-card', ...OA, mainCtrl.downloadReportCard);

  // Faculty
  router.get('/faculty',             ...OA, extraCtrl.getFaculty);
  router.post('/faculty',            ...ADM, extraCtrl.createFaculty);
  router.put('/faculty/:id',         ...ADM, extraCtrl.updateFaculty);

  // Batches
  router.get('/batches',             ...OA, mainCtrl.getAllBatches);
  router.post('/batches',            ...ADM, mainCtrl.createBatch);
  router.get('/batches/:id',         ...OA, mainCtrl.getBatch);
  router.put('/batches/:id',         ...ADM, mainCtrl.updateBatch);

  // Subjects
  router.get('/subjects',            ...OA, extraCtrl.getSubjects);
  router.post('/subjects',           ...ADM, extraCtrl.createSubject);
  router.delete('/subjects/:id',     ...ADM, extraCtrl.deleteSubject);

  // Schedule
  router.get('/schedules',           ...OA, extraCtrl.getSchedule);
  router.post('/schedules',          ...OA, authorize('admin', 'faculty'), extraCtrl.createSchedule);
  router.delete('/schedules/:id',    ...ADM, extraCtrl.deleteSchedule);

  // Attendance
  router.get('/attendance',          ...OA, mainCtrl.getAttendance);
  router.post('/attendance',         ...OA, mainCtrl.markAttendance);
  router.get('/attendance/summary',  ...OA, mainCtrl.getAttendanceSummary);

  // Fees
  router.get('/fees',                ...OA, mainCtrl.getFeeTransactions);
  router.post('/fees',               ...ADM, feeRules, validate, mainCtrl.addFeeTransaction);
  router.get('/fees/:id/receipt',    ...OA, mainCtrl.downloadReceipt);
  router.get('/fees/student/:student_id', ...OA, mainCtrl.getStudentFeeStatus);

  // Razorpay payment
  router.post('/payments/create-order',  ...OA, mainCtrl.createPaymentOrder);
  router.post('/payments/verify',        ...OA, mainCtrl.verifyPaymentAndRecord);

  // Exams
  router.get('/exams',               ...OA, mainCtrl.getExams);
  router.post('/exams',              ...OA, examRules, validate, mainCtrl.createExam);
  router.get('/exams/:id/results',   ...OA, mainCtrl.getExamResults);
  router.post('/exams/results',      ...OA, mainCtrl.saveResults);

  // Homework
  router.get('/homework',            ...OA, extraCtrl.getHomework);
  router.post('/homework',           ...OA, extraCtrl.createHomework);
  router.delete('/homework/:id',     ...ADM, extraCtrl.deleteHomework);
  // Homework submissions (previously missing)
  router.get('/homework/:homework_id/submissions', ...OA, extraCtrl.getHomeworkSubmissions);
  router.post('/homework/submit',    ...OA, upload.single('file'), extraCtrl.submitHomework);
  router.put('/homework/submissions/:submission_id/grade', ...OA, authorize('admin', 'faculty'), extraCtrl.gradeSubmission);

  // Study materials
  router.get('/materials',           ...OA, extraCtrl.getMaterials);
  router.post('/materials',          ...OA, upload.single('file'), extraCtrl.uploadMaterial);
  router.delete('/materials/:id',    ...ADM, extraCtrl.deleteMaterial);

  // Notices
  router.get('/notices',             ...OA, extraCtrl.getNotices);
  router.post('/notices',            ...ADM, noticeRules, validate, extraCtrl.createNotice);
  router.delete('/notices/:id',      ...ADM, extraCtrl.deleteNotice);

  // Enquiries
  router.get('/enquiries',           ...ADM, extraCtrl.getEnquiries);
  router.post('/enquiries',          ...OA, enquiryRules, validate, extraCtrl.createEnquiry);
  router.put('/enquiries/:id',       ...OA, extraCtrl.updateEnquiry);

  // Expenses
  router.get('/expenses',            ...ADM, extraCtrl.getExpenses);
  router.post('/expenses',           ...ADM, expenseRules, validate, extraCtrl.addExpense);
  router.delete('/expenses/:id',     ...ADM, extraCtrl.deleteExpense);

  // Settings
  router.get('/settings',            ...OA, extraCtrl.getSettings);
  router.put('/settings',            ...ADM, extraCtrl.updateSettings);

  // Reports
  router.get('/reports/revenue',     ...ADM, revenueReportRules, validate, extraCtrl.getRevenueReport);

  // ── Parent portal ─────────────────────────────────────────────────────────────
  const PA = [auth, checkLicense, authorize('parent')];
  router.get('/parent/children',                               ...PA, parentCtrl.getMyChildren);
  router.get('/parent/children/:student_id/attendance',        ...PA, parentCtrl.getChildAttendance);
  router.get('/parent/children/:student_id/exams',             ...PA, parentCtrl.getChildExamResults);
  router.get('/parent/children/:student_id/fees',              ...PA, parentCtrl.getChildFees);
  router.get('/parent/children/:student_id/homework',          ...PA, parentCtrl.getChildHomework);
  router.get('/parent/children/:student_id/upcoming-exams',    ...PA, parentCtrl.getUpcomingExams);
  router.get('/parent/notices',                                ...PA, parentCtrl.getNotices);
  // Admin: create parent account
  router.post('/parent/accounts', ...ADM, parentCtrl.createParentAccount);

  return router;
};
