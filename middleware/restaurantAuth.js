const jwt            = require('jsonwebtoken');
const RestaurantStaff    = require('../models/RestaurantStaff');
const RestaurantBusiness = require('../models/RestaurantBusiness');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ── Main auth middleware ──────────────────────────────────────────────────────
const restaurantAuth = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const { staffId, restaurantId } = jwt.verify(token, JWT_SECRET);

    const [staff, restaurant] = await Promise.all([
      RestaurantStaff.findById(staffId).select('-password -pin').lean(),
      RestaurantBusiness.findById(restaurantId).select('-password -token').lean()
    ]);

    if (!staff || staff.token !== token) {
      return res.status(401).json({ message: 'Session expired. Please login again.' });
    }
    if (!staff.isActive) {
      return res.status(403).json({ message: 'Your account has been deactivated.' });
    }
    if (!restaurant || !restaurant.isActive) {
      return res.status(403).json({ message: 'Restaurant account is inactive.' });
    }

    req.staff      = staff;
    req.restaurant = restaurant;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// ── Role guard factory ────────────────────────────────────────────────────────
// Usage: router.get('/admin', restaurantAuth, requireRole('owner', 'manager'), handler)
restaurantAuth.requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.staff.role)) {
    return res.status(403).json({
      message: `Access denied. Requires role: ${roles.join(' or ')}.`
    });
  }
  next();
};

// ── Permission guard factory ──────────────────────────────────────────────────
// Usage: router.post('/discount', restaurantAuth, requirePerm('applyDiscount'), handler)
restaurantAuth.requirePerm = (action) => (req, res, next) => {
  // Build effective permission (explicit override > role default)
  const explicit = req.staff.permissions?.[action];
  if (explicit !== null && explicit !== undefined) {
    if (!explicit) return res.status(403).json({ message: `No permission to '${action}'.` });
    return next();
  }
  const roleDefaults = {
    owner:    { viewMenu:true, editMenu:true, createOrder:true, editOrder:true, cancelOrder:true, applyDiscount:true, billing:true, voidBill:true, viewReports:true, manageStaff:true, manageSettings:true },
    manager:  { viewMenu:true, editMenu:true, createOrder:true, editOrder:true, cancelOrder:true, applyDiscount:true, billing:true, voidBill:true, viewReports:true, manageStaff:true, manageSettings:false },
    cashier:  { viewMenu:true, editMenu:false, createOrder:true, editOrder:false, cancelOrder:false, applyDiscount:true, billing:true, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    waiter:   { viewMenu:true, editMenu:false, createOrder:true, editOrder:true, cancelOrder:false, applyDiscount:false, billing:false, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    kitchen:  { viewMenu:true, editMenu:false, createOrder:false, editOrder:false, cancelOrder:false, applyDiscount:false, billing:false, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    delivery: {}
  };
  const allowed = (roleDefaults[req.staff.role] || {})[action];
  if (!allowed) return res.status(403).json({ message: `No permission to '${action}'.` });
  next();
};

module.exports = restaurantAuth;
