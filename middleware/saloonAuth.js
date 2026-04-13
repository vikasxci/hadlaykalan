const jwt            = require('jsonwebtoken');
const SaloonStaff    = require('../models/SaloonStaff');
const SaloonBusiness = require('../models/SaloonBusiness');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ── Main auth middleware ──────────────────────────────────────────────────────
const saloonAuth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const { staffId, saloonId } = jwt.verify(token, JWT_SECRET);

    const [staff, saloon] = await Promise.all([
      SaloonStaff.findById(staffId).select('-password -pin').lean(),
      SaloonBusiness.findById(saloonId).select('-password -token').lean()
    ]);

    if (!staff || staff.token !== token)
      return res.status(401).json({ message: 'Session expired. Please login again.' });
    if (!staff.isActive)
      return res.status(403).json({ message: 'Your account has been deactivated.' });
    if (!saloon || !saloon.isActive)
      return res.status(403).json({ message: 'Saloon account is inactive.' });

    req.staff  = staff;
    req.saloon = saloon;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// ── Role guard factory ────────────────────────────────────────────────────────
saloonAuth.requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.staff.role))
    return res.status(403).json({ message: `Access denied. Requires role: ${roles.join(' or ')}.` });
  next();
};

module.exports = saloonAuth;
