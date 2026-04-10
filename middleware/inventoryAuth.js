const jwt = require('jsonwebtoken');
const InventoryBusiness = require('../models/InventoryBusiness');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

module.exports = async function inventoryAuth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const { businessId } = jwt.verify(token, JWT_SECRET);
    const business = await InventoryBusiness.findById(businessId).select('-password');
    if (!business || business.token !== token) {
      return res.status(401).json({ message: 'Session expired. Please login again.' });
    }
    if (!business.isActive) {
      return res.status(403).json({ message: 'Account is inactive.' });
    }
    req.business = business;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token.' });
  }
};
