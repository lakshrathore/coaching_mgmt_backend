const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/db');

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

// ── Auth (public) ─────────────────────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);
router.get('/auth/me', auth, authCtrl.getMe);
router.put('/auth/change-password', auth, authCtrl.changePassword);

// ── Super Admin ───────────────────────────────────────────────────────────────
const SA = [auth, authorize('superadmin')];
router.get('/super/dashboard', ...SA, superCtrl.getSuperDashboard);
router.get('/super/orgs', ...SA, superCtrl.getAllOrgs);
router.post('/super/orgs', ...SA, superCtrl.createOrg);
router.get('/super/orgs/:id', ...SA, superCtrl.getOrg);
router.put('/super/orgs/:id', ...SA, superCtrl.updateOrg);
router.delete('/super/orgs/:id', ...SA, superCtrl.deleteOrg);
router.patch('/super/orgs/:id/toggle', ...SA, superCtrl.toggleOrgStatus);
router.put('/super/orgs/:org_id/license', ...SA, superCtrl.updateLicense);
router.post('/super/orgs/:org_id/license/renew', ...SA, superCtrl.renewLicense);
router.get('/super/orgs/:org_id/menus', ...SA, superCtrl.getMenuPermissions);
router.put('/super/orgs/:org_id/menus', ...SA, superCtrl.updateMenuPermissions);

// ── Org-scoped (require auth + active license) ────────────────────────────────
const OA = [auth, checkLicense];

router.get('/dashboard', ...OA, extraCtrl.getDashboardStats);

router.get('/students', ...OA, studentCtrl.getAll);
router.post('/students', ...OA, authorize('admin'), studentCtrl.create);
router.get('/students/:id', ...OA, studentCtrl.getOne);
router.put('/students/:id', ...OA, authorize('admin'), studentCtrl.update);
router.delete('/students/:id', ...OA, authorize('admin'), studentCtrl.remove);

router.get('/faculty', ...OA, extraCtrl.getFaculty);
router.post('/faculty', ...OA, authorize('admin'), extraCtrl.createFaculty);

router.get('/batches', ...OA, mainCtrl.getAllBatches);
router.post('/batches', ...OA, authorize('admin'), mainCtrl.createBatch);
router.get('/batches/:id', ...OA, mainCtrl.getBatch);
router.put('/batches/:id', ...OA, authorize('admin'), mainCtrl.updateBatch);

router.get('/subjects', ...OA, extraCtrl.getSubjects);
router.post('/subjects', ...OA, authorize('admin'), extraCtrl.createSubject);

router.get('/schedules', ...OA, extraCtrl.getSchedule);
router.post('/schedules', ...OA, authorize('admin', 'faculty'), extraCtrl.createSchedule);

router.get('/attendance', ...OA, mainCtrl.getAttendance);
router.post('/attendance', ...OA, mainCtrl.markAttendance);
router.get('/attendance/summary', ...OA, mainCtrl.getAttendanceSummary);

router.get('/fees', ...OA, mainCtrl.getFeeTransactions);
router.post('/fees', ...OA, authorize('admin'), mainCtrl.addFeeTransaction);
router.get('/fees/student/:student_id', ...OA, mainCtrl.getStudentFeeStatus);

router.get('/exams', ...OA, mainCtrl.getExams);
router.post('/exams', ...OA, mainCtrl.createExam);
router.get('/exams/:id/results', ...OA, mainCtrl.getExamResults);
router.post('/exams/results', ...OA, mainCtrl.saveResults);

router.get('/homework', ...OA, extraCtrl.getHomework);
router.post('/homework', ...OA, extraCtrl.createHomework);

router.get('/materials', ...OA, extraCtrl.getMaterials);
router.post('/materials', ...OA, upload.single('file'), extraCtrl.uploadMaterial);

router.get('/notices', ...OA, extraCtrl.getNotices);
router.post('/notices', ...OA, authorize('admin'), extraCtrl.createNotice);
router.delete('/notices/:id', ...OA, authorize('admin'), extraCtrl.deleteNotice);

router.get('/enquiries', ...OA, authorize('admin'), extraCtrl.getEnquiries);
router.post('/enquiries', ...OA, extraCtrl.createEnquiry);
router.put('/enquiries/:id', ...OA, extraCtrl.updateEnquiry);

router.get('/expenses', ...OA, authorize('admin'), extraCtrl.getExpenses);
router.post('/expenses', ...OA, authorize('admin'), extraCtrl.addExpense);

router.get('/settings', ...OA, extraCtrl.getSettings);
router.put('/settings', ...OA, authorize('admin'), extraCtrl.updateSettings);

router.get('/reports/revenue', ...OA, authorize('admin'), extraCtrl.getRevenueReport);

module.exports = router;
