const db = require('../config/db');
const { generateFeeReceipt, generateReportCard } = require('../services/pdfService');
const { notifyFeeReceived } = require('../services/notificationService');
const { createOrder, verifyPayment } = require('../services/paymentService');

// ── BATCHES ────────────────────────────────────────────────────────────────────
exports.getAllBatches = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT b.*,
             COUNT(DISTINCT sb.student_id) as student_count,
             GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') as subjects
      FROM batches b
      LEFT JOIN student_batches sb ON b.id = sb.batch_id AND sb.status = 'active'
      LEFT JOIN batch_subjects bs ON b.id = bs.batch_id
      LEFT JOIN subjects s ON bs.subject_id = s.id AND s.org_id = ?
      WHERE b.org_id = ? AND b.is_active = 1
      GROUP BY b.id ORDER BY b.name`,
      [req.orgId, req.orgId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getBatch = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM batches WHERE id = ? AND org_id = ?', [req.params.id, req.orgId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Batch not found' });
    const [students] = await db.execute(`
      SELECT u.id, u.name, u.phone, s.enrollment_no
      FROM student_batches sb
      JOIN students s ON sb.student_id = s.id AND s.org_id = ?
      JOIN users u ON s.user_id = u.id AND u.org_id = ?
      WHERE sb.batch_id = ? AND sb.status = 'active' ORDER BY u.name`,
      [req.orgId, req.orgId, req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], students } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createBatch = async (req, res) => {
  try {
    const { name, code, description, start_date, end_date, capacity, fee_amount,
            fee_frequency, timing_start, timing_end, days_of_week, subject_ids = [] } = req.body;
    const [result] = await db.execute(
      `INSERT INTO batches (org_id, name, code, description, start_date, end_date, capacity,
       fee_amount, fee_frequency, timing_start, timing_end, days_of_week)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, name, code, description, start_date || null, end_date || null,
       capacity || 30, fee_amount || 0, fee_frequency || 'monthly',
       timing_start || null, timing_end || null, days_of_week]
    );
    for (const subId of subject_ids) {
      const [sCheck] = await db.execute('SELECT id FROM subjects WHERE id = ? AND org_id = ?', [subId, req.orgId]);
      if (sCheck.length) {
        await db.execute('INSERT IGNORE INTO batch_subjects (batch_id, subject_id) VALUES (?, ?)', [result.insertId, subId]);
      }
    }
    res.status(201).json({ success: true, message: 'Batch created', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// FIXED: now also updates batch_subjects
exports.updateBatch = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { name, code, description, start_date, end_date, capacity, fee_amount,
            fee_frequency, timing_start, timing_end, days_of_week, is_active, subject_ids } = req.body;

    await conn.execute(
      `UPDATE batches SET name=?, code=?, description=?, start_date=?, end_date=?, capacity=?,
       fee_amount=?, fee_frequency=?, timing_start=?, timing_end=?, days_of_week=?, is_active=?
       WHERE id=? AND org_id=?`,
      [name, code, description, start_date || null, end_date || null, capacity, fee_amount,
       fee_frequency, timing_start || null, timing_end || null, days_of_week,
       is_active !== undefined ? is_active : 1, req.params.id, req.orgId]
    );

    // Update subjects if provided
    if (Array.isArray(subject_ids)) {
      await conn.execute('DELETE FROM batch_subjects WHERE batch_id = ?', [req.params.id]);
      for (const subId of subject_ids) {
        const [sCheck] = await conn.execute('SELECT id FROM subjects WHERE id = ? AND org_id = ?', [subId, req.orgId]);
        if (sCheck.length) {
          await conn.execute('INSERT IGNORE INTO batch_subjects (batch_id, subject_id) VALUES (?, ?)', [req.params.id, subId]);
        }
      }
    }
    await conn.commit();
    res.json({ success: true, message: 'Batch updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
};

// ── FEES ───────────────────────────────────────────────────────────────────────
exports.getFeeTransactions = async (req, res) => {
  try {
    const { batch_id, month_year, status, from_date, to_date } = req.query;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    let query = `
      SELECT ft.*, u.name as student_name, b.name as batch_name, ru.name as received_by_name
      FROM fee_transactions ft
      JOIN students s ON ft.student_id = s.id AND s.org_id = ?
      JOIN users u ON s.user_id = u.id
      LEFT JOIN batches b ON ft.batch_id = b.id AND b.org_id = ?
      LEFT JOIN users ru ON ft.received_by = ru.id
      WHERE ft.org_id = ?`;
    const params = [req.orgId, req.orgId, req.orgId];

    if (batch_id) { query += ' AND ft.batch_id = ?'; params.push(batch_id); }
    if (month_year) { query += ' AND ft.month_year = ?'; params.push(month_year); }
    if (status) { query += ' AND ft.status = ?'; params.push(status); }
    if (from_date) { query += ' AND ft.payment_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND ft.payment_date <= ?'; params.push(to_date); }

    // Count total
    const countQ = query.replace('SELECT ft.*, u.name as student_name, b.name as batch_name, ru.name as received_by_name', 'SELECT COUNT(*) as total');
    const [countRows] = await db.execute(countQ, params);
    const total = countRows[0].total;

    query += ' ORDER BY ft.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const [rows] = await db.execute(query, params);
    const pageTotal = rows.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
    res.json({ success: true, data: rows, total_records: total, page, limit, page_total: pageTotal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.addFeeTransaction = async (req, res) => {
  try {
    const { student_id, batch_id, amount, payment_date, due_date, payment_mode,
            transaction_ref, month_year, fee_type, status, discount_amount, discount_reason,
            remarks, send_notification } = req.body;

    const [sCheck] = await db.execute('SELECT s.*, u.name, u.phone, u.email FROM students s JOIN users u ON s.user_id=u.id WHERE s.id = ? AND s.org_id = ?', [student_id, req.orgId]);
    if (!sCheck.length) return res.status(403).json({ success: false, message: 'Invalid student' });
    const student = sCheck[0];

    // Generate receipt number
    const [[cntRow]] = await db.execute('SELECT COUNT(*) as cnt FROM fee_transactions WHERE org_id = ?', [req.orgId]);
    const receiptNo = `RCP${String(cntRow.cnt + 1).padStart(5, '0')}`;

    const paidDate = payment_date || new Date().toISOString().split('T')[0];
    const finalAmount = parseFloat(amount) - parseFloat(discount_amount || 0);

    const [result] = await db.execute(
      `INSERT INTO fee_transactions (org_id, student_id, batch_id, amount, payment_date, due_date,
       payment_mode, transaction_ref, month_year, fee_type, status, discount_amount,
       discount_reason, remarks, received_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, student_id, batch_id || null, finalAmount, paidDate, due_date || null,
       payment_mode || 'cash', transaction_ref || receiptNo, month_year,
       fee_type || 'tuition', status || 'paid', discount_amount || 0,
       discount_reason, remarks, req.user.id]
    );

    // Send notification if requested
    if (send_notification && (status === 'paid' || !status)) {
      const [settings] = await db.execute('SELECT coaching_name, currency_symbol FROM settings WHERE org_id = ?', [req.orgId]);
      const coachingName = settings[0]?.coaching_name || 'Coaching Center';
      notifyFeeReceived({
        studentName: student.name,
        amount: finalAmount,
        paymentMode: payment_mode || 'cash',
        receiptNo,
        phone: student.parent_phone || student.phone,
        email: student.parent_email || student.email,
        coachingName,
      }).catch(err => console.error('Notify error:', err.message));
    }

    res.status(201).json({ success: true, message: 'Payment recorded', id: result.insertId, receipt_no: receiptNo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Download fee receipt PDF
exports.downloadReceipt = async (req, res) => {
  try {
    const [txRows] = await db.execute(`
      SELECT ft.*, u.name as student_name, s.enrollment_no, s.father_name, s.parent_phone, s.parent_email,
             u.phone, u.email, b.name as batch_name, ru.name as received_by_name
      FROM fee_transactions ft
      JOIN students s ON ft.student_id = s.id AND s.org_id = ?
      JOIN users u ON s.user_id = u.id
      LEFT JOIN batches b ON ft.batch_id = b.id
      LEFT JOIN users ru ON ft.received_by = ru.id
      WHERE ft.id = ? AND ft.org_id = ?`,
      [req.orgId, req.params.id, req.orgId]
    );
    if (!txRows.length) return res.status(404).json({ success: false, message: 'Transaction not found' });
    const tx = txRows[0];

    const [settings] = await db.execute('SELECT * FROM settings WHERE org_id = ?', [req.orgId]);
    const s = settings[0] || {};

    const pdfBuffer = await generateFeeReceipt({
      receiptNo: tx.transaction_ref || `TXN${tx.id}`,
      coachingName: s.coaching_name,
      coachingAddress: s.address,
      coachingPhone: s.phone,
      coachingEmail: s.email,
      studentName: tx.student_name,
      enrollmentNo: tx.enrollment_no,
      fatherName: tx.father_name,
      phone: tx.phone,
      batchName: tx.batch_name,
      amount: tx.amount,
      discount: tx.discount_amount,
      finalAmount: tx.amount,
      paymentMode: tx.payment_mode,
      paymentDate: tx.payment_date,
      feeType: tx.fee_type,
      monthYear: tx.month_year,
      transactionRef: tx.transaction_ref,
      receivedBy: tx.received_by_name,
      currencySymbol: s.currency_symbol || '₹',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt_${tx.transaction_ref || tx.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStudentFeeStatus = async (req, res) => {
  try {
    const [check] = await db.execute('SELECT id FROM students WHERE id = ? AND org_id = ?', [req.params.student_id, req.orgId]);
    if (!check.length) return res.status(403).json({ success: false, message: 'Invalid student' });
    const [batches] = await db.execute(`
      SELECT b.id, b.name, b.fee_amount, b.fee_frequency,
             COALESCE(SUM(CASE WHEN ft.status='paid' THEN ft.amount ELSE 0 END), 0) as paid_amount,
             COALESCE(SUM(CASE WHEN ft.status='pending' THEN ft.amount ELSE 0 END), 0) as pending_amount
      FROM student_batches sb
      JOIN batches b ON sb.batch_id = b.id AND b.org_id = ?
      LEFT JOIN fee_transactions ft ON ft.student_id = sb.student_id AND ft.batch_id = b.id AND ft.org_id = ?
      WHERE sb.student_id = ? GROUP BY b.id`,
      [req.orgId, req.orgId, req.params.student_id]
    );
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── RAZORPAY PAYMENT ───────────────────────────────────────────────────────────
exports.createPaymentOrder = async (req, res) => {
  try {
    const { student_id, amount, batch_id, fee_type, month_year } = req.body;
    const [sCheck] = await db.execute('SELECT s.*, u.name FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=? AND s.org_id=?', [student_id, req.orgId]);
    if (!sCheck.length) return res.status(403).json({ success: false, message: 'Invalid student' });

    const order = await createOrder({
      amount,
      receipt: `fee_${student_id}_${Date.now()}`,
      notes: { student_id, batch_id, fee_type, month_year, org_id: req.orgId },
    });
    res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.verifyPaymentAndRecord = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature,
            student_id, batch_id, amount, fee_type, month_year } = req.body;

    const valid = verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!valid) return res.status(400).json({ success: false, message: 'Payment verification failed' });

    // Record the transaction
    req.body = {
      student_id, batch_id, amount, payment_mode: 'online',
      transaction_ref: razorpay_payment_id, fee_type, month_year,
      status: 'paid', send_notification: true,
    };
    return exports.addFeeTransaction(req, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── ATTENDANCE ─────────────────────────────────────────────────────────────────
exports.getAttendance = async (req, res) => {
  try {
    const { batch_id, date, month, student_id } = req.query;
    let query = `
      SELECT a.*, u.name as student_name, s.enrollment_no
      FROM attendance a
      JOIN students s ON a.student_id = s.id AND s.org_id = ?
      JOIN users u ON s.user_id = u.id
      WHERE a.org_id = ?`;
    const params = [req.orgId, req.orgId];
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
    const [bCheck] = await db.execute('SELECT id FROM batches WHERE id = ? AND org_id = ?', [batch_id, req.orgId]);
    if (!bCheck.length) return res.status(403).json({ success: false, message: 'Invalid batch' });
    for (const item of attendance_data) {
      const [sCheck] = await db.execute('SELECT id FROM students WHERE id = ? AND org_id = ?', [item.student_id, req.orgId]);
      if (!sCheck.length) continue;
      await db.execute(
        `INSERT INTO attendance (org_id, student_id, batch_id, date, status, marked_by, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status=?, marked_by=?, remarks=?`,
        [req.orgId, item.student_id, batch_id, date, item.status, req.user.id, item.remarks || null,
         item.status, req.user.id, item.remarks || null]
      );
    }
    res.json({ success: true, message: 'Attendance saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getAttendanceSummary = async (req, res) => {
  try {
    const { student_id, batch_id, month } = req.query;
    const [sCheck] = await db.execute('SELECT id FROM students WHERE id = ? AND org_id = ?', [student_id, req.orgId]);
    if (!sCheck.length) return res.status(403).json({ success: false, message: 'Invalid student' });
    const [rows] = await db.execute(`
      SELECT COUNT(*) as total_days, SUM(status='present') as present_days,
             SUM(status='absent') as absent_days, SUM(status='late') as late_days,
             ROUND(SUM(status='present')*100/COUNT(*), 1) as attendance_pct
      FROM attendance WHERE student_id=? AND batch_id=? AND DATE_FORMAT(date,'%Y-%m')=? AND org_id=?`,
      [student_id, batch_id, month, req.orgId]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── EXAMS ──────────────────────────────────────────────────────────────────────
exports.getExams = async (req, res) => {
  try {
    const { batch_id, subject_id } = req.query;
    let query = `
      SELECT e.*, b.name as batch_name, s.name as subject_name, COUNT(er.id) as results_entered
      FROM exams e
      LEFT JOIN batches b ON e.batch_id = b.id AND b.org_id = ?
      LEFT JOIN subjects s ON e.subject_id = s.id AND s.org_id = ?
      LEFT JOIN exam_results er ON e.id = er.exam_id
      WHERE e.org_id = ? AND e.is_active = 1`;
    const params = [req.orgId, req.orgId, req.orgId];
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
      `INSERT INTO exams (org_id, title, batch_id, subject_id, exam_date, start_time,
       duration_minutes, total_marks, passing_marks, exam_type, instructions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.orgId, title, batch_id || null, subject_id || null, exam_date || null, start_time || null,
       duration_minutes, total_marks, passing_marks, exam_type || 'unit_test', instructions, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Exam created', id: result.insertId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveResults = async (req, res) => {
  try {
    const { exam_id, results } = req.body;
    const [eCheck] = await db.execute('SELECT id FROM exams WHERE id = ? AND org_id = ?', [exam_id, req.orgId]);
    if (!eCheck.length) return res.status(403).json({ success: false, message: 'Invalid exam' });
    for (const r of results) {
      await db.execute(
        `INSERT INTO exam_results (exam_id, student_id, marks_obtained, grade, remarks, is_absent, entered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE marks_obtained=?, grade=?, remarks=?, is_absent=?, entered_by=?`,
        [exam_id, r.student_id, r.marks_obtained, r.grade, r.remarks, r.is_absent || 0, req.user.id,
         r.marks_obtained, r.grade, r.remarks, r.is_absent || 0, req.user.id]
      );
    }
    await db.execute(`
      UPDATE exam_results er
      JOIN (SELECT id, RANK() OVER (PARTITION BY exam_id ORDER BY marks_obtained DESC) as rnk
            FROM exam_results WHERE exam_id = ? AND is_absent = 0) ranked ON er.id = ranked.id
      SET er.rank = ranked.rnk WHERE er.exam_id = ?`, [exam_id, exam_id]);
    res.json({ success: true, message: 'Results saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getExamResults = async (req, res) => {
  try {
    const [eCheck] = await db.execute('SELECT id, total_marks, passing_marks FROM exams WHERE id = ? AND org_id = ?', [req.params.id, req.orgId]);
    if (!eCheck.length) return res.status(403).json({ success: false, message: 'Invalid exam' });
    const [rows] = await db.execute(`
      SELECT er.*, u.name as student_name, s.enrollment_no
      FROM exam_results er
      JOIN students s ON er.student_id = s.id AND s.org_id = ?
      JOIN users u ON s.user_id = u.id
      WHERE er.exam_id = ? ORDER BY er.rank, u.name`,
      [req.orgId, req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── REPORT CARD PDF ────────────────────────────────────────────────────────────
exports.downloadReportCard = async (req, res) => {
  try {
    const studentId = req.params.student_id;
    const [sCheck] = await db.execute(
      'SELECT s.*, u.name, u.email FROM students s JOIN users u ON s.user_id=u.id WHERE s.id=? AND s.org_id=?',
      [studentId, req.orgId]
    );
    if (!sCheck.length) return res.status(404).json({ success: false, message: 'Student not found' });
    const student = sCheck[0];

    // Get all exam results for this student
    const [results] = await db.execute(`
      SELECT er.*, e.title as exam_title, e.exam_date, e.total_marks, e.passing_marks, e.exam_type,
             s.name as subject_name, b.name as batch_name
      FROM exam_results er
      JOIN exams e ON er.exam_id = e.id AND e.org_id = ?
      LEFT JOIN subjects s ON e.subject_id = s.id
      LEFT JOIN batches b ON e.batch_id = b.id
      WHERE er.student_id = ?
      ORDER BY e.exam_date DESC`,
      [req.orgId, studentId]
    );

    // Get batch for this student (take first active batch)
    const [batches] = await db.execute(`
      SELECT b.name FROM student_batches sb JOIN batches b ON sb.batch_id=b.id
      WHERE sb.student_id=? AND sb.status='active' LIMIT 1`, [studentId]
    );

    // Get attendance summary across all batches
    const [att] = await db.execute(`
      SELECT COUNT(*) as total_days,
             SUM(status='present') as present_days,
             SUM(status='absent') as absent_days,
             SUM(status='late') as late_days,
             ROUND(SUM(status='present')*100/NULLIF(COUNT(*),0), 1) as attendance_pct
      FROM attendance WHERE student_id=? AND org_id=?`,
      [studentId, req.orgId]
    );

    const [settings] = await db.execute('SELECT * FROM settings WHERE org_id=?', [req.orgId]);
    const s = settings[0] || {};

    const pdfBuffer = await generateReportCard({
      coachingName: s.coaching_name,
      studentName: student.name,
      enrollmentNo: student.enrollment_no,
      batchName: batches[0]?.name || '',
      academicYear: s.academic_year,
      examResults: results,
      attendanceSummary: att[0],
      currencySymbol: s.currency_symbol || '₹',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="report_card_${student.enrollment_no || studentId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
