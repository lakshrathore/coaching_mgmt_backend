const bcrypt = require('bcryptjs');
const db = require('../config/db');

const ALL_MENUS = ['dashboard','students','faculty','batches','schedule','attendance','fees','exams','homework','materials','notices','enquiries','expenses','reports','settings'];

// ── Organizations ──────────────────────────────────────────────────────────────
exports.getAllOrgs = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT o.*,
             l.plan, l.status as license_status, l.end_date, l.max_students, l.max_faculty, l.max_batches,
             (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.role = 'student' AND u.is_active = 1) as student_count,
             (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.role = 'faculty' AND u.is_active = 1) as faculty_count,
             (SELECT COUNT(*) FROM batches b WHERE b.org_id = o.id AND b.is_active = 1) as batch_count
      FROM organizations o
      LEFT JOIN licenses l ON o.id = l.org_id
      ORDER BY o.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOrg = async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT o.*, l.plan, l.status as license_status, l.end_date, l.start_date,
             l.max_students, l.max_faculty, l.max_batches, l.notes as license_notes,
             s.coaching_name, s.currency_symbol, s.academic_year
      FROM organizations o
      LEFT JOIN licenses l ON o.id = l.org_id
      LEFT JOIN settings s ON o.id = s.org_id
      WHERE o.id = ?`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Org not found' });

    const [menus] = await db.execute('SELECT * FROM menu_permissions WHERE org_id = ?', [req.params.id]);
    const [users] = await db.execute(
      "SELECT id, name, email, role, is_active, created_at FROM users WHERE org_id = ? ORDER BY role, name",
      [req.params.id]
    );

    res.json({ success: true, data: { ...rows[0], menus, users } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createOrg = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const {
      name, slug, owner_name, owner_email, owner_phone, address,
      admin_password,
      plan = 'trial', license_days = 30,
      max_students = 50, max_faculty = 5, max_batches = 5
    } = req.body;

    if (!name || !slug || !owner_email)
      return res.status(400).json({ success: false, message: 'name, slug, owner_email required' });

    // Create org
    const [orgResult] = await conn.execute(
      `INSERT INTO organizations (name, slug, owner_name, owner_email, owner_phone, address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, slug, owner_name, owner_email, owner_phone, address]
    );
    const orgId = orgResult.insertId;

    // Create license
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(license_days));
    await conn.execute(
      `INSERT INTO licenses (org_id, plan, status, start_date, end_date, max_students, max_faculty, max_batches)
       VALUES (?, ?, 'active', CURDATE(), ?, ?, ?, ?)`,
      [orgId, plan, endDate.toISOString().split('T')[0], max_students, max_faculty, max_batches]
    );

    // Create settings
    await conn.execute(
      `INSERT INTO settings (org_id, coaching_name) VALUES (?, ?)`,
      [orgId, name]
    );

    // Create admin user
    const hashed = await bcrypt.hash(admin_password || 'password', 10);
    await conn.execute(
      `INSERT INTO users (org_id, name, email, phone, password, role)
       VALUES (?, ?, ?, ?, ?, 'admin')`,
      [orgId, owner_name || 'Admin', owner_email, owner_phone, hashed]
    );

    // Create all menu permissions (all enabled by default)
    for (const menu of ALL_MENUS) {
      await conn.execute(
        `INSERT INTO menu_permissions (org_id, menu_key, is_enabled, roles_allowed) VALUES (?, ?, 1, 'admin,faculty,student')`,
        [orgId, menu]
      );
    }

    await conn.commit();
    res.status(201).json({
      success: true,
      message: `Organization '${name}' created successfully`,
      org_id: orgId,
      login: { email: owner_email, password: admin_password || 'password', slug }
    });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Slug or email already exists' });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

exports.updateOrg = async (req, res) => {
  try {
    const { name, owner_name, owner_email, owner_phone, address, is_active } = req.body;
    await db.execute(
      `UPDATE organizations SET name=?, owner_name=?, owner_email=?, owner_phone=?, address=?, is_active=? WHERE id=?`,
      [name, owner_name, owner_email, owner_phone, address, is_active !== undefined ? is_active : 1, req.params.id]
    );
    res.json({ success: true, message: 'Organization updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteOrg = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const orgId = req.params.id;

    const [orgCheck] = await conn.execute('SELECT id FROM organizations WHERE id = ?', [orgId]);
    if (!orgCheck.length) return res.status(404).json({ success: false, message: 'Org not found' });

    // Step 1: Delete leaf junction tables first (no org_id column, reference by FK)
    // Get all exam IDs for this org
    const [examIds] = await conn.execute('SELECT id FROM exams WHERE org_id = ?', [orgId]);
    for (const e of examIds) {
      await conn.execute('DELETE FROM exam_results WHERE exam_id = ?', [e.id]);
    }
    // Get all homework IDs
    const [hwIds] = await conn.execute('SELECT id FROM homework WHERE org_id = ?', [orgId]);
    for (const h of hwIds) {
      await conn.execute('DELETE FROM homework_submissions WHERE homework_id = ?', [h.id]);
    }
    // Get all student IDs
    const [studentIds] = await conn.execute('SELECT id FROM students WHERE org_id = ?', [orgId]);
    for (const s of studentIds) {
      await conn.execute('DELETE FROM student_batches WHERE student_id = ?', [s.id]);
    }

    // Step 2: Delete tables with org_id in proper order
    const orgTables = [
      'attendance', 'fee_transactions', 'schedules', 'exams', 'homework',
      'study_materials', 'notices', 'enquiry_followups', 'enquiries',
      'expenses', 'batch_subjects', 'batches', 'menu_permissions', 'settings', 'licenses',
    ];
    for (const table of orgTables) {
      await conn.execute(`DELETE FROM ${table} WHERE org_id = ?`, [orgId]);
    }

    // Step 3: Delete users and their profile tables
    const [orgUsers] = await conn.execute('SELECT id FROM users WHERE org_id = ?', [orgId]);
    for (const u of orgUsers) {
      await conn.execute('DELETE FROM students WHERE user_id = ?', [u.id]);
      await conn.execute('DELETE FROM faculty WHERE user_id = ?', [u.id]);
    }
    await conn.execute('DELETE FROM users WHERE org_id = ?', [orgId]);
    await conn.execute('DELETE FROM organizations WHERE id = ?', [orgId]);

    await conn.commit();
    res.json({ success: true, message: 'Organization and all data deleted permanently' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
};

exports.toggleOrgStatus = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT is_active FROM organizations WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Org not found' });
    const newStatus = !rows[0].is_active;
    await db.execute('UPDATE organizations SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);
    res.json({ success: true, message: `Organization ${newStatus ? 'activated' : 'deactivated'}`, is_active: newStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Licenses ───────────────────────────────────────────────────────────────────
exports.updateLicense = async (req, res) => {
  try {
    const { plan, status, end_date, max_students, max_faculty, max_batches, notes } = req.body;
    await db.execute(
      `UPDATE licenses SET plan=?, status=?, end_date=?, max_students=?, max_faculty=?, max_batches=?, notes=?
       WHERE org_id=?`,
      [plan, status, end_date, max_students, max_faculty, max_batches, notes, req.params.org_id]
    );
    res.json({ success: true, message: 'License updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.renewLicense = async (req, res) => {
  try {
    const { days = 365, plan } = req.body;
    const newEnd = new Date();
    newEnd.setDate(newEnd.getDate() + parseInt(days));
    await db.execute(
      `UPDATE licenses SET status='active', end_date=?, plan=COALESCE(?,plan) WHERE org_id=?`,
      [newEnd.toISOString().split('T')[0], plan || null, req.params.org_id]
    );
    res.json({ success: true, message: `License renewed for ${days} days` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Menu Permissions ───────────────────────────────────────────────────────────
exports.getMenuPermissions = async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM menu_permissions WHERE org_id = ?', [req.params.org_id]);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateMenuPermissions = async (req, res) => {
  try {
    const { permissions } = req.body;
    // permissions: [{menu_key, is_enabled, roles_allowed}]
    for (const p of permissions) {
      await db.execute(
        `INSERT INTO menu_permissions (org_id, menu_key, is_enabled, roles_allowed)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE is_enabled=?, roles_allowed=?`,
        [req.params.org_id, p.menu_key, p.is_enabled ? 1 : 0, p.roles_allowed || 'admin,faculty,student',
         p.is_enabled ? 1 : 0, p.roles_allowed || 'admin,faculty,student']
      );
    }
    res.json({ success: true, message: 'Permissions updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Super Admin Dashboard ──────────────────────────────────────────────────────
exports.getSuperDashboard = async (req, res) => {
  try {
    const [[totalOrgs]] = await db.execute('SELECT COUNT(*) as total FROM organizations');
    const [[activeOrgs]] = await db.execute("SELECT COUNT(*) as total FROM organizations WHERE is_active = 1");
    const [[totalStudents]] = await db.execute("SELECT COUNT(*) as total FROM users WHERE role = 'student'");
    const [[expiringLicenses]] = await db.execute(
      "SELECT COUNT(*) as total FROM licenses WHERE status = 'active' AND end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)"
    );
    const [[expiredLicenses]] = await db.execute(
      "SELECT COUNT(*) as total FROM licenses WHERE status = 'active' AND end_date < CURDATE()"
    );
    const [recentOrgs] = await db.execute(
      `SELECT o.id, o.name, o.slug, o.is_active, o.created_at, l.plan, l.status as license_status, l.end_date
       FROM organizations o LEFT JOIN licenses l ON o.id = l.org_id
       ORDER BY o.created_at DESC LIMIT 5`
    );
    const [licenseAlerts] = await db.execute(
      `SELECT o.name, o.slug, l.plan, l.status, l.end_date,
              DATEDIFF(l.end_date, CURDATE()) as days_left
       FROM licenses l JOIN organizations o ON l.org_id = o.id
       WHERE l.end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND l.status = 'active'
       ORDER BY l.end_date ASC`
    );

    res.json({
      success: true,
      data: {
        stats: {
          total_orgs: totalOrgs.total,
          active_orgs: activeOrgs.total,
          total_students: totalStudents.total,
          expiring_soon: expiringLicenses.total,
          expired: expiredLicenses.total,
        },
        recent_orgs: recentOrgs,
        license_alerts: licenseAlerts,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
