const bcrypt = require('bcryptjs');
const db = require('../config/db');

// ── SUBJECTS ───────────────────────────────────────────────────────────────────
exports.getSubjects = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM subjects WHERE org_id = ? AND is_active = 1 ORDER BY name',
      [req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createSubject = async (req, res) => {
  try {
    const { name, code, description } = req.body;
    const [result] = await db.execute(
      'INSERT INTO subjects (org_id, name, code, description) VALUES (?, ?, ?, ?)',
      [req.orgId, name, code, description]
    );
    res.status(201).json({ success: true, message: 'Subject added', id: result.insertId });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── FACULTY ────────────────────────────────────────────────────────────────────
exports.getFaculty = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT u.id, u.name, u.email, u.phone, u.is_active,
             f.employee_id, f.qualification, f.specialization, f.experience_years, f.joining_date,
             GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as subjects_taught
      FROM users u
      JOIN faculty f ON u.id = f.user_id AND f.org_id = ?
      LEFT JOIN batch_subjects bs ON u.id = bs.faculty_id
      LEFT JOIN subjects s ON bs.subject_id = s.id AND s.org_id = ?
      WHERE u.role = 'faculty' AND u.org_id = ?
      GROUP BY u.id, f.id ORDER BY u.name`,
      [req.orgId, req.orgId, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createFaculty = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { name, email, phone, password, qualification, specialization, experience_years, joining_date, salary, address } = req.body;
    const [countRows] = await conn.execute('SELECT COUNT(*) as cnt FROM faculty WHERE org_id = ?', [req.orgId]);
    const employee_id = `FAC${String(countRows[0].cnt + 1).padStart(3, '0')}`;
    const hashed = await bcrypt.hash(password || phone || '123456', 10);

    const [userResult] = await conn.execute(
      'INSERT INTO users (org_id, name, email, phone, password, role) VALUES (?, ?, ?, ?, ?, "faculty")',
      [req.orgId, name, email || null, phone, hashed]
    );
    await conn.execute(
      `INSERT INTO faculty (org_id, user_id, employee_id, qualification, specialization, experience_years, joining_date, salary, address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, userResult.insertId, employee_id, qualification, specialization, experience_years || 0, joining_date, salary, address]
    );
    await conn.commit();
    res.status(201).json({ success: true, message: 'Faculty added', employee_id });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Email already exists' });
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ── NOTICES ────────────────────────────────────────────────────────────────────
exports.getNotices = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT n.*, u.name as published_by_name, b.name as batch_name
      FROM notices n
      LEFT JOIN users u ON n.published_by = u.id AND u.org_id = ?
      LEFT JOIN batches b ON n.batch_id = b.id AND b.org_id = ?
      WHERE n.org_id = ? AND n.is_active = 1 AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
      ORDER BY n.priority DESC, n.publish_date DESC LIMIT 50`,
      [req.orgId, req.orgId, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createNotice = async (req, res) => {
  try {
    const { title, content, target_role, batch_id, priority, expiry_date } = req.body;
    await db.execute(
      `INSERT INTO notices (org_id, title, content, target_role, batch_id, priority, published_by, publish_date, expiry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
      [req.orgId, title, content, target_role || 'all', batch_id || null, priority || 'normal', req.user.id, expiry_date || null]
    );
    res.status(201).json({ success: true, message: 'Notice published' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteNotice = async (req, res) => {
  try {
    await db.execute('UPDATE notices SET is_active = 0 WHERE id = ? AND org_id = ?', [req.params.id, req.orgId]);
    res.json({ success: true, message: 'Notice removed' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── HOMEWORK ───────────────────────────────────────────────────────────────────
exports.getHomework = async (req, res) => {
  try {
    const { batch_id, subject_id } = req.query;
    let query = `
      SELECT h.*, b.name as batch_name, s.name as subject_name, u.name as assigned_by_name,
             COUNT(hs.id) as submissions_count
      FROM homework h
      LEFT JOIN batches b ON h.batch_id = b.id AND b.org_id = ?
      LEFT JOIN subjects s ON h.subject_id = s.id AND s.org_id = ?
      LEFT JOIN users u ON h.assigned_by = u.id AND u.org_id = ?
      LEFT JOIN homework_submissions hs ON h.id = hs.homework_id
      WHERE h.org_id = ?`;
    const params = [req.orgId, req.orgId, req.orgId, req.orgId];
    if (batch_id) { query += ' AND h.batch_id = ?'; params.push(batch_id); }
    if (subject_id) { query += ' AND h.subject_id = ?'; params.push(subject_id); }
    query += ' GROUP BY h.id ORDER BY h.assign_date DESC';
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createHomework = async (req, res) => {
  try {
    const { title, description, batch_id, subject_id, due_date } = req.body;
    await db.execute(
      'INSERT INTO homework (org_id, title, description, batch_id, subject_id, due_date, assigned_by, assign_date) VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())',
      [req.orgId, title, description, batch_id || null, subject_id || null, due_date, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Homework assigned' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── STUDY MATERIALS ────────────────────────────────────────────────────────────
exports.getMaterials = async (req, res) => {
  try {
    const { batch_id, subject_id } = req.query;
    let query = `
      SELECT sm.*, b.name as batch_name, s.name as subject_name, u.name as uploaded_by_name
      FROM study_materials sm
      LEFT JOIN batches b ON sm.batch_id = b.id AND b.org_id = ?
      LEFT JOIN subjects s ON sm.subject_id = s.id AND s.org_id = ?
      LEFT JOIN users u ON sm.uploaded_by = u.id AND u.org_id = ?
      WHERE sm.org_id = ?`;
    const params = [req.orgId, req.orgId, req.orgId, req.orgId];
    if (batch_id) { query += ' AND sm.batch_id = ?'; params.push(batch_id); }
    if (subject_id) { query += ' AND sm.subject_id = ?'; params.push(subject_id); }
    query += ' ORDER BY sm.created_at DESC';
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.uploadMaterial = async (req, res) => {
  try {
    const { title, description, batch_id, subject_id, is_public } = req.body;
    const file = req.file;
    await db.execute(
      `INSERT INTO study_materials (org_id, title, description, batch_id, subject_id, file_path, file_type, file_size, is_public, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, title, description, batch_id || null, subject_id || null,
       file ? `/uploads/${file.filename}` : null,
       file ? file.mimetype : null, file ? file.size : null,
       is_public ? 1 : 0, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Material uploaded' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── ENQUIRIES ──────────────────────────────────────────────────────────────────
exports.getEnquiries = async (req, res) => {
  try {
    const { status, source } = req.query;
    let query = `
      SELECT e.*, u.name as assigned_to_name, COUNT(ef.id) as followup_count
      FROM enquiries e
      LEFT JOIN users u ON e.assigned_to = u.id AND u.org_id = ?
      LEFT JOIN enquiry_followups ef ON e.id = ef.enquiry_id
      WHERE e.org_id = ?`;
    const params = [req.orgId, req.orgId];
    if (status) { query += ' AND e.status = ?'; params.push(status); }
    if (source) { query += ' AND e.source = ?'; params.push(source); }
    query += ' GROUP BY e.id ORDER BY e.created_at DESC';
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createEnquiry = async (req, res) => {
  try {
    const { name, phone, email, interested_batch, source, notes, next_follow_up, assigned_to } = req.body;
    await db.execute(
      `INSERT INTO enquiries (org_id, name, phone, email, interested_batch, source, notes, next_follow_up, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, phone, email, interested_batch, source || 'walk-in', notes, next_follow_up || null, assigned_to || null]
    );
    res.status(201).json({ success: true, message: 'Enquiry added' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateEnquiry = async (req, res) => {
  try {
    const { status, next_follow_up, notes, assigned_to } = req.body;
    await db.execute(
      'UPDATE enquiries SET status=?, next_follow_up=?, notes=?, assigned_to=? WHERE id=? AND org_id=?',
      [status, next_follow_up || null, notes, assigned_to || null, req.params.id, req.orgId]
    );
    if (notes) {
      await db.execute(
        'INSERT INTO enquiry_followups (enquiry_id, notes, next_followup_date, followed_by) VALUES (?, ?, ?, ?)',
        [req.params.id, notes, next_follow_up || null, req.user.id]
      );
    }
    res.json({ success: true, message: 'Enquiry updated' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── EXPENSES ───────────────────────────────────────────────────────────────────
exports.getExpenses = async (req, res) => {
  try {
    const { category, from_date, to_date } = req.query;
    let query = `
      SELECT e.*, u.name as added_by_name FROM expenses e
      LEFT JOIN users u ON e.added_by = u.id AND u.org_id = ?
      WHERE e.org_id = ?`;
    const params = [req.orgId, req.orgId];
    if (category) { query += ' AND e.category = ?'; params.push(category); }
    if (from_date) { query += ' AND e.expense_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND e.expense_date <= ?'; params.push(to_date); }
    query += ' ORDER BY e.expense_date DESC';
    const [rows] = await db.execute(query, params);
    const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0);
    res.json({ success: true, data: rows, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.addExpense = async (req, res) => {
  try {
    const { title, amount, category, expense_date, payment_mode, notes } = req.body;
    await db.execute(
      'INSERT INTO expenses (org_id, title, amount, category, expense_date, payment_mode, notes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.orgId, title, amount, category || 'other', expense_date || new Date().toISOString().split('T')[0], payment_mode || 'cash', notes, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Expense recorded' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── SETTINGS ───────────────────────────────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM settings WHERE org_id = ?', [req.orgId]);
    res.json({ success: true, data: rows[0] || {} });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateSettings = async (req, res) => {
  try {
    const { coaching_name, address, phone, email, currency, currency_symbol, academic_year } = req.body;
    await db.execute(
      `UPDATE settings SET coaching_name=?, address=?, phone=?, email=?, currency=?, currency_symbol=?, academic_year=?
       WHERE org_id=?`,
      [coaching_name, address, phone, email, currency, currency_symbol, academic_year, req.orgId]
    );
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── SCHEDULE ───────────────────────────────────────────────────────────────────
exports.getSchedule = async (req, res) => {
  try {
    const { batch_id } = req.query;
    let query = `
      SELECT sc.*, b.name as batch_name, s.name as subject_name, u.name as faculty_name
      FROM schedules sc
      LEFT JOIN batches b ON sc.batch_id = b.id AND b.org_id = ?
      LEFT JOIN subjects s ON sc.subject_id = s.id AND s.org_id = ?
      LEFT JOIN users u ON sc.faculty_id = u.id AND u.org_id = ?
      WHERE sc.org_id = ? AND sc.is_active = 1`;
    const params = [req.orgId, req.orgId, req.orgId, req.orgId];
    if (batch_id) { query += ' AND sc.batch_id = ?'; params.push(batch_id); }
    query += " ORDER BY FIELD(sc.day_of_week,'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'), sc.start_time";
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createSchedule = async (req, res) => {
  try {
    const { batch_id, subject_id, faculty_id, day_of_week, start_time, end_time, room } = req.body;
    await db.execute(
      'INSERT INTO schedules (org_id, batch_id, subject_id, faculty_id, day_of_week, start_time, end_time, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.orgId, batch_id, subject_id || null, faculty_id || null, day_of_week, start_time, end_time, room]
    );
    res.status(201).json({ success: true, message: 'Schedule added' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const o = req.orgId;
    const [[students]] = await db.execute(`SELECT COUNT(*) as total FROM users WHERE org_id=? AND role='student' AND is_active=1`, [o]);
    const [[faculty]] = await db.execute(`SELECT COUNT(*) as total FROM users WHERE org_id=? AND role='faculty' AND is_active=1`, [o]);
    const [[batches]] = await db.execute(`SELECT COUNT(*) as total FROM batches WHERE org_id=? AND is_active=1`, [o]);
    const [[enquiries]] = await db.execute(`SELECT COUNT(*) as total FROM enquiries WHERE org_id=? AND status='new'`, [o]);
    const [[monthRevenue]] = await db.execute(
      `SELECT COALESCE(SUM(amount),0) as total FROM fee_transactions
       WHERE org_id=? AND MONTH(payment_date)=MONTH(CURDATE()) AND YEAR(payment_date)=YEAR(CURDATE()) AND status='paid'`, [o]
    );
    const [[monthExpenses]] = await db.execute(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses
       WHERE org_id=? AND MONTH(expense_date)=MONTH(CURDATE()) AND YEAR(expense_date)=YEAR(CURDATE())`, [o]
    );
    const [recentStudents] = await db.execute(
      `SELECT u.name, u.created_at, s.enrollment_no FROM users u
       JOIN students s ON u.id=s.user_id AND s.org_id=?
       WHERE u.org_id=? AND u.role='student' ORDER BY u.created_at DESC LIMIT 5`, [o, o]
    );
    const [recentNotices] = await db.execute(
      `SELECT title, priority, publish_date FROM notices WHERE org_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 5`, [o]
    );
    const [upcomingExams] = await db.execute(
      `SELECT e.title, e.exam_date, b.name as batch_name, s.name as subject_name
       FROM exams e
       LEFT JOIN batches b ON e.batch_id=b.id AND b.org_id=?
       LEFT JOIN subjects s ON e.subject_id=s.id AND s.org_id=?
       WHERE e.org_id=? AND e.exam_date >= CURDATE() AND e.is_active=1
       ORDER BY e.exam_date ASC LIMIT 5`, [o, o, o]
    );
    const [monthlyRevenue] = await db.execute(
      `SELECT DATE_FORMAT(payment_date,'%b %Y') as month, SUM(amount) as revenue
       FROM fee_transactions WHERE org_id=? AND status='paid' AND payment_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(payment_date,'%Y-%m') ORDER BY MIN(payment_date)`, [o]
    );

    res.json({
      success: true,
      data: {
        stats: {
          students: students.total, faculty: faculty.total,
          batches: batches.total, new_enquiries: enquiries.total,
          month_revenue: parseFloat(monthRevenue.total),
          month_expenses: parseFloat(monthExpenses.total),
        },
        recent_students: recentStudents,
        recent_notices: recentNotices,
        upcoming_exams: upcomingExams,
        monthly_revenue: monthlyRevenue,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── REPORTS ────────────────────────────────────────────────────────────────────
exports.getRevenueReport = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;
    const o = req.orgId;
    const [byBatch] = await db.execute(
      `SELECT b.name, SUM(ft.amount) as total, COUNT(*) as txn_count
       FROM fee_transactions ft JOIN batches b ON ft.batch_id=b.id AND b.org_id=?
       WHERE ft.org_id=? AND ft.status='paid' AND ft.payment_date BETWEEN ? AND ?
       GROUP BY b.id ORDER BY total DESC`, [o, o, from_date, to_date]
    );
    const [byMode] = await db.execute(
      `SELECT payment_mode, SUM(amount) as total, COUNT(*) as count
       FROM fee_transactions WHERE org_id=? AND status='paid' AND payment_date BETWEEN ? AND ?
       GROUP BY payment_mode`, [o, from_date, to_date]
    );
    const [[totalRevenue]] = await db.execute(
      `SELECT COALESCE(SUM(amount),0) as total FROM fee_transactions WHERE org_id=? AND status='paid' AND payment_date BETWEEN ? AND ?`, [o, from_date, to_date]
    );
    const [[totalExpenses]] = await db.execute(
      `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE org_id=? AND expense_date BETWEEN ? AND ?`, [o, from_date, to_date]
    );
    res.json({
      success: true,
      data: {
        revenue_by_batch: byBatch, revenue_by_mode: byMode,
        total_revenue: parseFloat(totalRevenue.total),
        total_expenses: parseFloat(totalExpenses.total),
        net_profit: parseFloat(totalRevenue.total) - parseFloat(totalExpenses.total),
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
