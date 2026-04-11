const bcrypt = require('bcryptjs');
const db = require('../config/db');

// Get all students with batch info
exports.getAll = async (req, res) => {
  try {
    const { search, batch_id, status } = req.query;
    let query = `
      SELECT u.id, u.name, u.email, u.phone, u.is_active, u.profile_pic,
             s.id as student_id, s.enrollment_no, s.father_name, s.parent_phone,
             s.gender, s.standard, s.school_name, s.admission_date,
             GROUP_CONCAT(DISTINCT b.name ORDER BY b.name SEPARATOR ', ') as batches
      FROM users u
      JOIN students s ON u.id = s.user_id
      LEFT JOIN student_batches sb ON s.id = sb.student_id AND sb.status = 'active'
      LEFT JOIN batches b ON sb.batch_id = b.id
      WHERE u.role = 'student'
    `;
    const params = [];

    if (search) {
      query += ` AND (u.name LIKE ? OR u.phone LIKE ? OR s.enrollment_no LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (batch_id) {
      query += ` AND sb.batch_id = ?`;
      params.push(batch_id);
    }
    if (status) {
      query += ` AND u.is_active = ?`;
      params.push(status === 'active' ? 1 : 0);
    }

    query += ` GROUP BY u.id, s.id ORDER BY u.name`;
    const [rows] = await db.execute(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get single student detail
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.profile_pic, u.created_at,
              s.*, 
              GROUP_CONCAT(DISTINCT b.name ORDER BY b.name SEPARATOR ', ') as batches
       FROM users u
       JOIN students s ON u.id = s.user_id
       LEFT JOIN student_batches sb ON s.id = sb.student_id
       LEFT JOIN batches b ON sb.batch_id = b.id
       WHERE u.id = ?
       GROUP BY u.id, s.id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Student not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Create student
exports.create = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      name, email, phone, password,
      father_name, mother_name, parent_phone, parent_email,
      date_of_birth, gender, address, school_name, standard, board,
      admission_date, reference_source, notes, batch_ids = []
    } = req.body;

    // Generate enrollment no
    const [countRows] = await conn.execute('SELECT COUNT(*) as cnt FROM students');
    const count = countRows[0].cnt + 1;
    const enrollment_no = `STU${String(count).padStart(4, '0')}`;

    const hashed = await bcrypt.hash(password || phone || '123456', 10);
    const [userResult] = await conn.execute(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, "student")',
      [name, email || null, phone, hashed]
    );
    const userId = userResult.insertId;

    const [stuResult] = await conn.execute(
      `INSERT INTO students (user_id, enrollment_no, father_name, mother_name, parent_phone, parent_email,
       date_of_birth, gender, address, school_name, standard, board, admission_date, reference_source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, enrollment_no, father_name, mother_name, parent_phone, parent_email,
       date_of_birth || null, gender, address, school_name, standard, board,
       admission_date || new Date().toISOString().split('T')[0], reference_source, notes]
    );
    const studentId = stuResult.insertId;

    for (const batchId of batch_ids) {
      await conn.execute(
        'INSERT IGNORE INTO student_batches (student_id, batch_id) VALUES (?, ?)',
        [studentId, batchId]
      );
    }

    await conn.commit();
    res.status(201).json({ success: true, message: 'Student added successfully', enrollment_no });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// Update student
exports.update = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      name, email, phone, is_active,
      father_name, mother_name, parent_phone, parent_email,
      date_of_birth, gender, address, school_name, standard, board,
      reference_source, notes, batch_ids
    } = req.body;

    await conn.execute(
      'UPDATE users SET name=?, email=?, phone=?, is_active=? WHERE id=?',
      [name, email || null, phone, is_active !== undefined ? is_active : 1, req.params.id]
    );

    await conn.execute(
      `UPDATE students SET father_name=?, mother_name=?, parent_phone=?, parent_email=?,
       date_of_birth=?, gender=?, address=?, school_name=?, standard=?, board=?, reference_source=?, notes=?
       WHERE user_id=?`,
      [father_name, mother_name, parent_phone, parent_email,
       date_of_birth || null, gender, address, school_name, standard, board,
       reference_source, notes, req.params.id]
    );

    if (batch_ids !== undefined) {
      const [stuRows] = await conn.execute('SELECT id FROM students WHERE user_id = ?', [req.params.id]);
      const studentId = stuRows[0].id;
      await conn.execute('DELETE FROM student_batches WHERE student_id = ?', [studentId]);
      for (const batchId of batch_ids) {
        await conn.execute(
          'INSERT IGNORE INTO student_batches (student_id, batch_id) VALUES (?, ?)',
          [studentId, batchId]
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Student updated successfully' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

// Delete student
exports.remove = async (req, res) => {
  try {
    await db.execute('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Student deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
