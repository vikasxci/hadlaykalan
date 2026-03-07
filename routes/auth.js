const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const auth = require('../middleware/auth');

// Login (supports both admin and sarpanch)
router.post('/login', async (req, res) => {
  try {
    const { email, password, loginRole } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // If loginRole specified, validate it matches user role
    if (loginRole && admin.role !== loginRole) {
      return res.status(403).json({ message: `Access denied for ${loginRole} panel` });
    }

    // Update login tracking
    admin.lastLogin = new Date();
    admin.loginCount = (admin.loginCount || 0) + 1;
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ 
      token, 
      admin: { id: admin._id, name: admin.name, email: admin.email, role: admin.role } 
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Verify token
router.get('/verify', auth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password');
    res.json(admin);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
