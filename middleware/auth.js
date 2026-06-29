const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded; // { id, email, role }
    next();
  } catch (err) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

// Only main admin can manage sub-admins
module.exports.requireAdmin = function(req, res, next) {
  if (req.admin && req.admin.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Only the main admin can perform this action' });
  }
};

// Role-based middleware factory
module.exports.requireRole = function(role) {
  return function(req, res, next) {
    if (req.admin && req.admin.role === role) {
      next();
    } else {
      res.status(403).json({ message: 'Insufficient permissions' });
    }
  };
};
