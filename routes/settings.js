const express = require('express');
const router = express.Router();
const AreaLocation = require('../models/AreaLocation');
const Role = require('../models/Role');
const auth = require('../middleware/auth');

// ============ AREA LOCATIONS ============

// GET all active areas (public)
router.get('/areas', async (req, res) => {
  try {
    const areas = await AreaLocation.find({ isActive: true }).sort({ name: 1 });
    res.json(areas);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all areas (admin)
router.get('/areas/admin/all', auth, async (req, res) => {
  try {
    const areas = await AreaLocation.find().sort({ name: 1 });
    res.json(areas);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create area (admin)
router.post('/areas', auth, async (req, res) => {
  try {
    const { name, nameHi } = req.body;
    if (!name) return res.status(400).json({ message: 'Area name is required' });
    const area = new AreaLocation({ name: name.trim(), nameHi: nameHi ? nameHi.trim() : '' });
    await area.save();
    res.status(201).json(area);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Area already exists' });
    res.status(500).json({ message: err.message });
  }
});

// PUT update area (admin)
router.put('/areas/:id', auth, async (req, res) => {
  try {
    const { name, nameHi, isActive } = req.body;
    const area = await AreaLocation.findById(req.params.id);
    if (!area) return res.status(404).json({ message: 'Area not found' });
    if (name) area.name = name.trim();
    if (nameHi !== undefined) area.nameHi = nameHi.trim();
    if (isActive !== undefined) area.isActive = isActive;
    await area.save();
    res.json(area);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE area (admin)
router.delete('/areas/:id', auth, async (req, res) => {
  try {
    await AreaLocation.findByIdAndDelete(req.params.id);
    res.json({ message: 'Area deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ ROLES ============

// GET all active roles (public)
router.get('/roles', async (req, res) => {
  try {
    const roles = await Role.find({ isActive: true }).sort({ label: 1 });
    res.json(roles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all roles (admin)
router.get('/roles/admin/all', auth, async (req, res) => {
  try {
    const roles = await Role.find().sort({ label: 1 });
    res.json(roles);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create role (admin)
router.post('/roles', auth, async (req, res) => {
  try {
    const { name, label, labelHi, icon } = req.body;
    if (!name || !label) return res.status(400).json({ message: 'Name and label are required' });
    const role = new Role({
      name: name.trim().toLowerCase().replace(/\s+/g, '_'),
      label: label.trim(),
      labelHi: labelHi ? labelHi.trim() : '',
      icon: icon || 'fa-user'
    });
    await role.save();
    res.status(201).json(role);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Role already exists' });
    res.status(500).json({ message: err.message });
  }
});

// PUT update role (admin)
router.put('/roles/:id', auth, async (req, res) => {
  try {
    const { name, label, labelHi, icon, isActive } = req.body;
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    if (name) role.name = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (label) role.label = label.trim();
    if (labelHi !== undefined) role.labelHi = labelHi.trim();
    if (icon) role.icon = icon;
    if (isActive !== undefined) role.isActive = isActive;
    await role.save();
    res.json(role);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE role (admin)
router.delete('/roles/:id', auth, async (req, res) => {
  try {
    await Role.findByIdAndDelete(req.params.id);
    res.json({ message: 'Role deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
