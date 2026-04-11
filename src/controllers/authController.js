const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    // Find user by email — could be superadmin or any org user
    const [users] = await db.execute(
      'SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1',
      [email]
    );

    if (!users.length)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const user = users[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    // Super admin — no org needed
    if (user.role === 'superadmin') {
      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
      return res.json({
        success: true,
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          org_id: null,
          coaching_name: 'System Admin',
          currency_symbol: '₹',
          menu_permissions: [],
          license: null,
        },
      });
    }

    // Org user — check org is active
    if (!user.org_id)
      return res.status(401).json({ success: false, message: 'User is not associated with any organization' });

    const [orgRows] = await db.execute(
      'SELECT id, name, is_active FROM organizations WHERE id = ?',
      [user.org_id]
    );

    if (!orgRows.length || !orgRows[0].is_active)
      return res.status(403).json({ success: false, message: 'Your organization is inactive. Contact support.' });

    // Check license
    const [licRows] = await db.execute(
      'SELECT plan, status, end_date FROM licenses WHERE org_id = ?',
      [user.org_id]
    );

    if (!licRows.length)
      return res.status(403).json({ success: false, message: 'No license found. Contact support.' });

    const lic = licRows[0];
    if (lic.status !== 'active')
      return res.status(403).json({ success: false, message: `License is ${lic.status}. Contact your administrator.` });

    if (new Date(lic.end_date) < new Date())
      return res.status(403).json({ success: false, message: 'License has expired. Please renew.' });

    // Fetch org settings
    const [settRows] = await db.execute(
      'SELECT coaching_name, currency_symbol, academic_year FROM settings WHERE org_id = ?',
      [user.org_id]
    );
    const settings = settRows[0] || {};

    // Fetch menu permissions for this org
    const [menuRows] = await db.execute(
      'SELECT menu_key, is_enabled, roles_allowed FROM menu_permissions WHERE org_id = ?',
      [user.org_id]
    );

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
        org_name: orgRows[0].name,
        coaching_name: settings.coaching_name || orgRows[0].name,
        currency_symbol: settings.currency_symbol || '₹',
        academic_year: settings.academic_year || '',
        profile_pic: user.profile_pic,
        menu_permissions: menuRows,
        license: { plan: lic.plan, status: lic.status, end_date: lic.end_date },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
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
      const [menuRows] = await db.execute(
        'SELECT menu_key, is_enabled, roles_allowed FROM menu_permissions WHERE org_id = ?',
        [user.org_id]
      );
      extra = { ...(sRows[0] || {}), menu_permissions: menuRows };
    }
    res.json({ success: true, data: { ...user, ...extra } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const [rows] = await db.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(current_password, rows[0].password);
    if (!match)
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(new_password, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
