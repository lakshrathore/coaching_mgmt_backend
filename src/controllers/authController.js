const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

exports.login = async (req, res) => {
  try {
    const { email, password, org_slug } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    let user, orgData = null;

    if (org_slug) {
      // Org user login
      const [orgRows] = await db.execute(
        'SELECT id, name, is_active FROM organizations WHERE slug = ?',
        [org_slug]
      );
      if (!orgRows.length || !orgRows[0].is_active)
        return res.status(404).json({ success: false, message: 'Organization not found or inactive' });

      orgData = orgRows[0];
      const [users] = await db.execute(
        'SELECT * FROM users WHERE email = ? AND org_id = ?',
        [email, orgData.id]
      );
      if (!users.length)
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      user = users[0];
    } else {
      // Super admin login (no org_slug)
      const [users] = await db.execute(
        "SELECT * FROM users WHERE email = ? AND role = 'superadmin'",
        [email]
      );
      if (!users.length)
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      user = users[0];
    }

    if (!user.is_active)
      return res.status(401).json({ success: false, message: 'Account is disabled' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // Fetch settings & license for org users
    let settings = {};
    let license = null;
    if (user.org_id) {
      const [sRows] = await db.execute('SELECT * FROM settings WHERE org_id = ?', [user.org_id]);
      settings = sRows[0] || {};

      const [lRows] = await db.execute('SELECT * FROM licenses WHERE org_id = ?', [user.org_id]);
      if (lRows.length) {
        license = lRows[0];
        if (license.status !== 'active' || new Date(license.end_date) < new Date()) {
          return res.status(403).json({ success: false, message: 'License expired or suspended. Contact support.' });
        }
      }

      // Fetch menu permissions
      const [menuRows] = await db.execute(
        'SELECT menu_key, is_enabled, roles_allowed FROM menu_permissions WHERE org_id = ?',
        [user.org_id]
      );
      settings.menu_permissions = menuRows;
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        org_id: user.org_id,
        org_name: orgData?.name || settings.coaching_name || null,
        org_slug: org_slug || null,
        profile_pic: user.profile_pic,
        currency_symbol: settings.currency_symbol || '₹',
        coaching_name: settings.coaching_name || 'Coaching Manager',
        menu_permissions: settings.menu_permissions || [],
        license: license ? { plan: license.plan, status: license.status, end_date: license.end_date } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, name, email, phone, role, org_id, profile_pic FROM users WHERE id = ?',
      [req.user.id]
    );
    const user = rows[0];
    let extra = {};
    if (user.org_id) {
      const [sRows] = await db.execute('SELECT * FROM settings WHERE org_id = ?', [user.org_id]);
      const [menuRows] = await db.execute('SELECT menu_key, is_enabled, roles_allowed FROM menu_permissions WHERE org_id = ?', [user.org_id]);
      extra = { ...(sRows[0] || {}), menu_permissions: menuRows };
    }
    res.json({ success: true, data: { ...user, ...extra } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOrganizations = async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT o.id, o.name, o.slug FROM organizations o WHERE o.is_active = 1 ORDER BY o.name`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(current_password, rows[0].password);
    if (!match) return res.status(400).json({ success: false, message: 'Current password incorrect' });
    const hashed = await bcrypt.hash(new_password, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
