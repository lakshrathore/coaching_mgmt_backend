const db = require('../config/db');

// ===================== BATCHES =====================
exports.getAllBatches = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT b.*, 
             COUNT(DISTINCT sb.student_id) as student_count,
             GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as subjects
      FROM batches b
      LEFT JOIN student_batches sb ON b.id = sb.batch_id AND sb.status = 'active'
      LEFT JOIN batch_subjects bs ON b.id = bs.batch_id
      LEFT JOIN subjects s ON bs.subject_id = s.id
      WHERE b.is_active = 1
      GROUP BY b.id
      ORDER BY b.name`);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBatch = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM batches WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Batch not found' });
    
    const [students] = await db.execute(`
      SELECT u.id, u.name, u.phone, s.enrollment_no
      FROM student_batches sb
      JOIN students s ON sb.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE sb.batch_id = ? AND sb.status = 'active'
      ORDER BY u.name`, [req.params.id]);
    
    res.json({ success: true, data: { ...rows[0], students } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createBatch = async (req, res) => {
  try {
    const { name, code, description, start_date, end_date, capacity, fee_amount, fee_frequency,
            timing_start, timing_end, days_of_week, subject_ids = [] } = req.body;

    const [result] = await db.execute(
      `INSERT INTO batches (name, code, description, start_date, end_date, capacity, fee_amount,
       fee_frequency, timing_start, timing_end, days_of_week) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, code, description, start_date, end_date, capacity || 30, fee_amount || 0,
       fee_frequency || 'monthly', timing_start, timing_end, days_of_week]
    );

    for (const subId of subject_ids) {
      await db.execute(
        'INSERT IGNORE INTO batch_subjects (batch_id, subject_id) VALUES (?, ?)',
        [result.insertId, subId]
      );
    }
    res.status(201).json({ success: true, message: 'Batch created', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateBatch = async (req, res) => {
  try {
    const { name, code, description, start_date, end_date, capacity, fee_amount, fee_frequency,
            timing_start, timing_end, days_of_week, is_active } = req.body;
    await db.execute(
      `UPDATE batches SET name=?, code=?, description=?, start_date=?, end_date=?, capacity=?,
       fee_amount=?, fee_frequency=?, timing_start=?, timing_end=?, days_of_week=?, is_active=?
       WHERE id=?`,
      [name, code, description, start_date, end_date, capacity, fee_amount, fee_frequency,
       timing_start, timing_end, days_of_week, is_active !== undefined ? is_active : 1, req.params.id]
    );
    res.json({ success: true, message: 'Batch updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===================== FEES =====================
exports.getFeeTransactions = async (req, res) => {
  try {
    const { student_id, batch_id, month_year, status, from_date, to_date } = req.query;
    let query = `
      SELECT ft.*, u.name as student_name, b.name as batch_name,
             ru.name as received_by_name
      FROM fee_transactions ft
      JOIN students s ON ft.student_id = s.id
      JOIN users u ON s.user_id = u.id
      LEFT JOIN batches b ON ft.batch_id = b.id
      LEFT JOIN users ru ON ft.received_by = ru.id
      WHERE 1=1`;
    const params = [];

    if (student_id) { query += ' AND ft.student_id = ?'; params.push(student_id); }
    if (batch_id) { query += ' AND ft.batch_id = ?'; params.push(batch_id); }
    if (month_year) { query += ' AND ft.month_year = ?'; params.push(month_year); }
    if (status) { query += ' AND ft.status = ?'; params.push(status); }
    if (from_date) { query += ' AND ft.payment_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND ft.payment_date <= ?'; params.push(to_date); }

    query += ' ORDER BY ft.created_at DESC';
    const [rows] = await db.execute(query, params);
    
    const total = rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    res.json({ success: true, data: rows, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addFeeTransaction = async (req, res) => {
  try {
    const { student_id, batch_id, amount, payment_date, due_date, payment_mode,
            transaction_ref, month_year, fee_type, status, discount_amount, discount_reason, remarks } = req.body;

    const [result] = await db.execute(
      `INSERT INTO fee_transactions (student_id, batch_id, amount, payment_date, due_date, payment_mode,
       transaction_ref, month_year, fee_type, status, discount_amount, discount_reason, remarks, received_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [student_id, batch_id, amount, payment_date || new Date().toISOString().split('T')[0],
       due_date, payment_mode || 'cash', transaction_ref, month_year, fee_type || 'tuition',
       status || 'paid', discount_amount || 0, discount_reason, remarks, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Payment recorded', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStudentFeeStatus = async (req, res) => {
  try {
    const { student_id } = req.params;
    const [batches] = await db.execute(`
      SELECT b.id, b.name, b.fee_amount, b.fee_frequency,
             COALESCE(SUM(CASE WHEN ft.status='paid' THEN ft.amount ELSE 0 END), 0) as paid_amount,
             COALESCE(SUM(CASE WHEN ft.status='pending' THEN ft.amount ELSE 0 END), 0) as pending_amount
      FROM student_batches sb
      JOIN batches b ON sb.batch_id = b.id
      LEFT JOIN fee_transactions ft ON ft.student_id = sb.student_id AND ft.batch_id = b.id
      WHERE sb.student_id = ?
      GROUP BY b.id`, [student_id]);
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===================== ATTENDANCE =====================
exports.getAttendance = async (req, res) => {
  try {
    const { batch_id, date, month, student_id } = req.query;
    let query = `
      SELECT a.*, u.name as student_name, s.enrollment_no
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE 1=1`;
    const params = [];

    if (batch_id) { query += ' AND a.batch_id = ?'; params.push(batch_id); }
    if (date) { query += ' AND a.date = ?'; params.push(date); }
    if (month) { query += ' AND DATE_FORMAT(a.date, "%Y-%m") = ?'; params.push(month); }
    if (student_id) { query += ' AND a.student_id = ?'; params.push(student_id); }

    query += ' ORDER BY a.date DESC, u.name';
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.markAttendance = async (req, res) => {
  try {
    const { batch_id, date, attendance_data } = req.body;
    // attendance_data: [{student_id, status, remarks}]
    for (const item of attendance_data) {
      await db.execute(
        `INSERT INTO attendance (student_id, batch_id, date, status, marked_by, remarks)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status=?, marked_by=?, remarks=?`,
        [item.student_id, batch_id, date, item.status, req.user.id, item.remarks || null,
         item.status, req.user.id, item.remarks || null]
      );
    }
    res.json({ success: true, message: 'Attendance marked successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAttendanceSummary = async (req, res) => {
  try {
    const { student_id, batch_id, month } = req.query;
    const [rows] = await db.execute(`
      SELECT 
        COUNT(*) as total_days,
        SUM(status='present') as present_days,
        SUM(status='absent') as absent_days,
        SUM(status='late') as late_days,
        ROUND(SUM(status='present')*100/COUNT(*), 1) as attendance_pct
      FROM attendance
      WHERE student_id = ? AND batch_id = ? AND DATE_FORMAT(date, '%Y-%m') = ?`,
      [student_id, batch_id, month]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ===================== EXAMS =====================
exports.getExams = async (req, res) => {
  try {
    const { batch_id, subject_id } = req.query;
    let query = `
      SELECT e.*, b.name as batch_name, s.name as subject_name,
             COUNT(er.id) as results_entered
      FROM exams e
      LEFT JOIN batches b ON e.batch_id = b.id
      LEFT JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN exam_results er ON e.id = er.exam_id
      WHERE e.is_active = 1`;
    const params = [];
    if (batch_id) { query += ' AND e.batch_id = ?'; params.push(batch_id); }
    if (subject_id) { query += ' AND e.subject_id = ?'; params.push(subject_id); }
    query += ' GROUP BY e.id ORDER BY e.exam_date DESC';
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createExam = async (req, res) => {
  try {
    const { title, batch_id, subject_id, exam_date, start_time, duration_minutes,
            total_marks, passing_marks, exam_type, instructions } = req.body;
    const [result] = await db.execute(
      `INSERT INTO exams (title, batch_id, subject_id, exam_date, start_time, duration_minutes,
       total_marks, passing_marks, exam_type, instructions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, batch_id, subject_id, exam_date, start_time, duration_minutes,
       total_marks, passing_marks, exam_type || 'unit_test', instructions, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Exam created', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveResults = async (req, res) => {
  try {
    const { exam_id, results } = req.body;
    for (const r of results) {
      await db.execute(
        `INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade, remarks, is_absent, entered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE marks_obtained=?, grade=?, remarks=?, is_absent=?, entered_by=?`,
        [exam_id, r.student_id, r.marks_obtained, r.grade, r.remarks, r.is_absent || 0, req.user.id,
         r.marks_obtained, r.grade, r.remarks, r.is_absent || 0, req.user.id]
      );
    }
    // Assign ranks
    await db.execute(`
      UPDATE exam_results er
      JOIN (
        SELECT id, RANK() OVER (PARTITION BY exam_id ORDER BY marks_obtained DESC) as rnk
        FROM exam_results WHERE exam_id = ? AND is_absent = 0
      ) ranked ON er.id = ranked.id
      SET er.rank = ranked.rnk WHERE er.exam_id = ?`, [exam_id, exam_id]);
    res.json({ success: true, message: 'Results saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getExamResults = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT er.*, u.name as student_name, s.enrollment_no
      FROM exam_results er
      JOIN students s ON er.student_id = s.id
      JOIN users u ON s.user_id = u.id
      WHERE er.exam_id = ?
      ORDER BY er.rank, u.name`, [req.params.id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
