const jwt = require('jsonwebtoken');
const db = require('../config/db');

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await db.execute(
      'SELECT id, name, email, role, org_id, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!rows.length || !rows[0].is_active)
      return res.status(401).json({ success: false, message: 'Invalid or inactive user' });

    req.user = rows[0];
    req.orgId = rows[0].org_id;
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Access denied' });
  next();
};

const checkLicense = async (req, res, next) => {
  if (req.user.role === 'superadmin') return next();
  try {
    const [rows] = await db.execute(
      'SELECT status, end_date FROM licenses WHERE org_id = ?',
      [req.orgId]
    );
    if (!rows.length) return res.status(403).json({ success: false, message: 'No license found' });
    if (rows[0].status !== 'active') return res.status(403).json({ success: false, message: `License ${rows[0].status}. Contact support.` });
    if (new Date(rows[0].end_date) < new Date()) return res.status(403).json({ success: false, message: 'License expired. Please renew.' });
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { auth, authorize, checkLicense };
