const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const auth = require('../middleware/auth');

// ── Login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password, loginRole } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // If loginRole specified, validate it matches user role (skip check for subadmin)
    if (loginRole && admin.role !== 'subadmin' && admin.role !== loginRole) {
      return res.status(403).json({ message: `Access denied for ${loginRole} panel` });
    }

    admin.lastLogin = new Date();
    admin.loginCount = (admin.loginCount || 0) + 1;
    await admin.save();

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role, permissions: admin.permissions },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Verify token ──────────────────────────────────────────────
router.get('/verify', auth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id).select('-password');
    if (!admin) return res.status(404).json({ message: 'Admin not found' });
    res.json({ admin });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Sub-admin management (main admin only) ────────────────────

// List all sub-admins
router.get('/subadmins', auth, auth.requireAdmin, async (req, res) => {
  try {
    const subadmins = await Admin.find({ role: 'subadmin' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(subadmins);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create sub-admin
router.post('/subadmins', auth, auth.requireAdmin, async (req, res) => {
  try {
    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    const existing = await Admin.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already in use' });

    const subadmin = new Admin({
      name,
      email,
      password,
      role: 'subadmin',
      permissions: permissions || [],
      createdBy: req.admin.id
    });
    await subadmin.save();
    res.status(201).json({ message: 'Sub-admin created', subadmin: { id: subadmin._id, name, email, permissions: subadmin.permissions } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update sub-admin (name, email, password, permissions)
router.put('/subadmins/:id', auth, auth.requireAdmin, async (req, res) => {
  try {
    const subadmin = await Admin.findOne({ _id: req.params.id, role: 'subadmin' });
    if (!subadmin) return res.status(404).json({ message: 'Sub-admin not found' });

    const { name, email, password, permissions } = req.body;
    if (name) subadmin.name = name;
    if (email && email !== subadmin.email) {
      const existing = await Admin.findOne({ email, _id: { $ne: subadmin._id } });
      if (existing) return res.status(400).json({ message: 'Email already in use' });
      subadmin.email = email;
    }
    if (password) subadmin.password = password; // pre-save hook re-hashes
    if (permissions !== undefined) subadmin.permissions = permissions;

    await subadmin.save();
    res.json({ message: 'Sub-admin updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete sub-admin
router.delete('/subadmins/:id', auth, auth.requireAdmin, async (req, res) => {
  try {
    const result = await Admin.findOneAndDelete({ _id: req.params.id, role: 'subadmin' });
    if (!result) return res.status(404).json({ message: 'Sub-admin not found' });
    res.json({ message: 'Sub-admin deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
