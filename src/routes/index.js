const express = require('express');
const router = express.Router();
const multer = require('multer');

const { auth, authorize, checkLicense } = require('../middleware/auth');
const authCtrl = require('../controllers/authController');
const studentCtrl = require('../controllers/studentController');
const mainCtrl = require('../controllers/mainController');
const extraCtrl = require('../controllers/extraController');
const superCtrl = require('../controllers/superAdminController');

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);
router.get('/auth/organizations', authCtrl.getOrganizations); // For login dropdown
router.get('/auth/me', auth, authCtrl.getMe);
router.put('/auth/change-password', auth, authCtrl.changePassword);

// ── Super Admin only ──────────────────────────────────────────────────────────
const SA = [auth, authorize('superadmin')];

router.get('/super/dashboard', ...SA, superCtrl.getSuperDashboard);

// Org CRUD
router.get('/super/orgs', ...SA, superCtrl.getAllOrgs);
router.post('/super/orgs', ...SA, superCtrl.createOrg);
router.get('/super/orgs/:id', ...SA, superCtrl.getOrg);
router.put('/super/orgs/:id', ...SA, superCtrl.updateOrg);
router.delete('/super/orgs/:id', ...SA, superCtrl.deleteOrg);
router.patch('/super/orgs/:id/toggle', ...SA, superCtrl.toggleOrgStatus);

// License
router.put('/super/orgs/:org_id/license', ...SA, superCtrl.updateLicense);
router.post('/super/orgs/:org_id/license/renew', ...SA, superCtrl.renewLicense);

// Menu Permissions
router.get('/super/orgs/:org_id/menus', ...SA, superCtrl.getMenuPermissions);
router.put('/super/orgs/:org_id/menus', ...SA, superCtrl.updateMenuPermissions);

// ── Org-scoped routes (require auth + license) ────────────────────────────────
const OA = [auth, checkLicense];

router.get('/dashboard', ...OA, extraCtrl.getDashboardStats);

// Students
router.get('/students', ...OA, studentCtrl.getAll);
router.post('/students', ...OA, authorize('admin', 'superadmin'), studentCtrl.create);
router.get('/students/:id', ...OA, studentCtrl.getOne);
router.put('/students/:id', ...OA, authorize('admin', 'superadmin'), studentCtrl.update);
router.delete('/students/:id', ...OA, authorize('admin', 'superadmin'), studentCtrl.remove);

// Faculty
router.get('/faculty', ...OA, extraCtrl.getFaculty);
router.post('/faculty', ...OA, authorize('admin', 'superadmin'), extraCtrl.createFaculty);

// Batches
router.get('/batches', ...OA, mainCtrl.getAllBatches);
router.post('/batches', ...OA, authorize('admin', 'superadmin'), mainCtrl.createBatch);
router.get('/batches/:id', ...OA, mainCtrl.getBatch);
router.put('/batches/:id', ...OA, authorize('admin', 'superadmin'), mainCtrl.updateBatch);

// Subjects
router.get('/subjects', ...OA, extraCtrl.getSubjects);
router.post('/subjects', ...OA, authorize('admin', 'superadmin'), extraCtrl.createSubject);

// Schedule
router.get('/schedules', ...OA, extraCtrl.getSchedule);
router.post('/schedules', ...OA, extraCtrl.createSchedule);

// Attendance
router.get('/attendance', ...OA, mainCtrl.getAttendance);
router.post('/attendance', ...OA, mainCtrl.markAttendance);
router.get('/attendance/summary', ...OA, mainCtrl.getAttendanceSummary);

// Fees
router.get('/fees', ...OA, mainCtrl.getFeeTransactions);
router.post('/fees', ...OA, authorize('admin', 'superadmin'), mainCtrl.addFeeTransaction);
router.get('/fees/student/:student_id', ...OA, mainCtrl.getStudentFeeStatus);

// Exams
router.get('/exams', ...OA, mainCtrl.getExams);
router.post('/exams', ...OA, mainCtrl.createExam);
router.get('/exams/:id/results', ...OA, mainCtrl.getExamResults);
router.post('/exams/results', ...OA, mainCtrl.saveResults);

// Homework
router.get('/homework', ...OA, extraCtrl.getHomework);
router.post('/homework', ...OA, extraCtrl.createHomework);

// Materials
router.get('/materials', ...OA, extraCtrl.getMaterials);
router.post('/materials', ...OA, upload.single('file'), extraCtrl.uploadMaterial);

// Notices
router.get('/notices', ...OA, extraCtrl.getNotices);
router.post('/notices', ...OA, authorize('admin', 'superadmin'), extraCtrl.createNotice);
router.delete('/notices/:id', ...OA, authorize('admin', 'superadmin'), extraCtrl.deleteNotice);

// Enquiries
router.get('/enquiries', ...OA, authorize('admin', 'superadmin'), extraCtrl.getEnquiries);
router.post('/enquiries', ...OA, extraCtrl.createEnquiry);
router.put('/enquiries/:id', ...OA, extraCtrl.updateEnquiry);

// Expenses
router.get('/expenses', ...OA, authorize('admin', 'superadmin'), extraCtrl.getExpenses);
router.post('/expenses', ...OA, authorize('admin', 'superadmin'), extraCtrl.addExpense);

// Settings
router.get('/settings', ...OA, extraCtrl.getSettings);
router.put('/settings', ...OA, authorize('admin', 'superadmin'), extraCtrl.updateSettings);

// Menu permissions (for org admin)
router.get('/menus', ...OA, (req, res) => {
  db.execute('SELECT * FROM menu_permissions WHERE org_id = ?', [req.orgId])
    .then(([rows]) => res.json({ success: true, data: rows }))
    .catch(err => res.status(500).json({ success: false, message: err.message }));
});

// Reports
router.get('/reports/revenue', ...OA, authorize('admin', 'superadmin'), extraCtrl.getRevenueReport);

const db = require('../config/db');
module.exports = router;
