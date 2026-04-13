const db = require('../config/db');
const bcrypt = require('bcryptjs');

// ── Parent: get their linked children ─────────────────────────────────────────
exports.getMyChildren = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT s.id as student_id, u.name, u.phone, u.email, u.profile_pic,
             s.enrollment_no, s.standard, s.school_name, s.admission_date,
             GROUP_CONCAT(DISTINCT b.name ORDER BY b.name SEPARATOR ', ') as batches
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN student_batches sb ON s.id = sb.student_id AND sb.status = 'active'
      LEFT JOIN batches b ON sb.batch_id = b.id
      WHERE (s.parent_phone = ? OR s.parent_email = ?) AND s.org_id = ?
      GROUP BY s.id`,
      [req.user.phone, req.user.email, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: child attendance ───────────────────────────────────────────────────
exports.getChildAttendance = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!await isMyChild(req, studentId)) return res.status(403).json({ success: false, message: 'Access denied' });

    const { month, batch_id } = req.query;
    let query = `
      SELECT a.date, a.status, a.remarks, b.name as batch_name, s.name as subject_name
      FROM attendance a
      LEFT JOIN batches b ON a.batch_id = b.id
      LEFT JOIN subjects s ON a.subject_id = s.id
      WHERE a.student_id = ? AND a.org_id = ?`;
    const params = [studentId, req.orgId];
    if (month) { query += ' AND DATE_FORMAT(a.date, "%Y-%m") = ?'; params.push(month); }
    if (batch_id) { query += ' AND a.batch_id = ?'; params.push(batch_id); }
    query += ' ORDER BY a.date DESC';

    const [rows] = await db.execute(query, params);

    // Summary
    const [summary] = await db.execute(`
      SELECT COUNT(*) as total_days,
             SUM(status='present') as present_days,
             SUM(status='absent') as absent_days,
             SUM(status='late') as late_days,
             ROUND(SUM(status='present')*100/NULLIF(COUNT(*),0), 1) as attendance_pct
      FROM attendance WHERE student_id = ? AND org_id = ?
      ${month ? 'AND DATE_FORMAT(date, "%Y-%m") = ?' : ''}`,
      month ? [studentId, req.orgId, month] : [studentId, req.orgId]
    );

    res.json({ success: true, data: rows, summary: summary[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: child exam results ─────────────────────────────────────────────────
exports.getChildExamResults = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!await isMyChild(req, studentId)) return res.status(403).json({ success: false, message: 'Access denied' });

    const [rows] = await db.execute(`
      SELECT er.marks_obtained, er.grade, er.rank, er.remarks, er.is_absent,
             e.title as exam_title, e.exam_date, e.total_marks, e.passing_marks, e.exam_type,
             s.name as subject_name, b.name as batch_name
      FROM exam_results er
      JOIN exams e ON er.exam_id = e.id AND e.org_id = ?
      LEFT JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN batches b ON e.batch_id = b.id
      WHERE er.student_id = ?
      ORDER BY e.exam_date DESC`,
      [req.orgId, studentId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: child fee status ───────────────────────────────────────────────────
exports.getChildFees = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!await isMyChild(req, studentId)) return res.status(403).json({ success: false, message: 'Access denied' });

    const [transactions] = await db.execute(`
      SELECT ft.id, ft.amount, ft.payment_date, ft.due_date, ft.payment_mode,
             ft.transaction_ref, ft.month_year, ft.fee_type, ft.status,
             ft.discount_amount, ft.remarks, b.name as batch_name
      FROM fee_transactions ft
      LEFT JOIN batches b ON ft.batch_id = b.id
      WHERE ft.student_id = ? AND ft.org_id = ?
      ORDER BY ft.payment_date DESC`,
      [studentId, req.orgId]
    );

    const [pending] = await db.execute(`
      SELECT COALESCE(SUM(amount),0) as total_pending
      FROM fee_transactions WHERE student_id=? AND org_id=? AND status='pending'`,
      [studentId, req.orgId]
    );

    res.json({ success: true, data: transactions, total_pending: pending[0].total_pending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: child homework ─────────────────────────────────────────────────────
exports.getChildHomework = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!await isMyChild(req, studentId)) return res.status(403).json({ success: false, message: 'Access denied' });

    const [rows] = await db.execute(`
      SELECT h.id, h.title, h.description, h.assign_date, h.due_date, h.file_path,
             s.name as subject_name, b.name as batch_name,
             hs.status as submission_status, hs.marks_given, hs.submission_date
      FROM homework h
      JOIN student_batches sb ON h.batch_id = sb.batch_id AND sb.student_id = ? AND sb.status = 'active'
      LEFT JOIN subjects s ON h.subject_id = s.id
      LEFT JOIN batches b ON h.batch_id = b.id
      LEFT JOIN homework_submissions hs ON h.id = hs.homework_id AND hs.student_id = ?
      WHERE h.org_id = ? AND h.is_active = 1
      ORDER BY h.due_date DESC`,
      [studentId, studentId, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: notices for their org ─────────────────────────────────────────────
exports.getNotices = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT n.title, n.content, n.priority, n.publish_date, n.target_role,
             b.name as batch_name
      FROM notices n
      LEFT JOIN batches b ON n.batch_id = b.id
      WHERE n.org_id = ? AND n.is_active = 1
        AND (n.target_role = 'all' OR n.target_role = 'parent')
        AND (n.expiry_date IS NULL OR n.expiry_date >= CURDATE())
      ORDER BY n.priority DESC, n.publish_date DESC LIMIT 30`,
      [req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Parent: upcoming exams for their children ──────────────────────────────────
exports.getUpcomingExams = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    if (!await isMyChild(req, studentId)) return res.status(403).json({ success: false, message: 'Access denied' });

    const [rows] = await db.execute(`
      SELECT e.title, e.exam_date, e.start_time, e.duration_minutes, e.total_marks,
             e.exam_type, e.instructions, s.name as subject_name, b.name as batch_name
      FROM exams e
      JOIN student_batches sb ON e.batch_id = sb.batch_id AND sb.student_id = ? AND sb.status='active'
      LEFT JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN batches b ON e.batch_id = b.id
      WHERE e.org_id = ? AND e.exam_date >= CURDATE() AND e.is_active = 1
      ORDER BY e.exam_date ASC`,
      [studentId, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Admin: create parent account linked to a student ──────────────────────────
exports.createParentAccount = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { student_id, name, phone, email, password } = req.body;

    // Verify student belongs to this org
    const [sCheck] = await conn.execute(
      'SELECT s.*, u.name as student_name FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=? AND s.org_id=?',
      [student_id, req.orgId]
    );
    if (!sCheck.length) return res.status(404).json({ success: false, message: 'Student not found' });
    const student = sCheck[0];

    // Check if parent user already exists with this phone/email
    const contactValue = email || phone;
    const [existing] = await conn.execute(
      'SELECT id FROM users WHERE (email=? OR phone=?) AND org_id=? AND role="parent"',
      [contactValue, phone, req.orgId]
    );
    if (existing.length) {
      // Link existing parent to student
      await conn.execute(
        'UPDATE students SET parent_phone=?, parent_email=? WHERE id=?',
        [phone, email || null, student_id]
      );
      await conn.commit();
      return res.json({ success: true, message: 'Existing parent account linked to student', user_id: existing[0].id });
    }

    const hashed = await bcrypt.hash(password || phone, 12);
    const [result] = await conn.execute(
      'INSERT INTO users (org_id, name, email, phone, password, role, must_change_password) VALUES (?,?,?,?,?,"parent",1)',
      [req.orgId, name || `Parent of ${student.student_name}`, email || null, phone, hashed]
    );

    // Update student record with parent contact
    await conn.execute(
      'UPDATE students SET parent_phone=?, parent_email=? WHERE id=?',
      [phone, email || null, student_id]
    );

    await conn.commit();
    res.status(201).json({
      success: true,
      message: 'Parent account created',
      user_id: result.insertId,
      login: { phone, password: password || phone },
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Phone/email already registered' });
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ── Helper ─────────────────────────────────────────────────────────────────────
async function isMyChild(req, studentId) {
  const [rows] = await db.execute(
    'SELECT id FROM students WHERE id=? AND org_id=? AND (parent_phone=? OR parent_email=?)',
    [studentId, req.orgId, req.user.phone || '', req.user.email || '']
  );
  return rows.length > 0;
}
