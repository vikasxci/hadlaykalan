const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const Monitor = require('../models/Monitor');
const { pingMonitor } = require('../services/monitorService');

// ── Public: list all active monitors (status page) ──────────────────
// GET /api/uptime/public
router.get('/public', async (req, res) => {
  try {
    const monitors = await Monitor.find({ isActive: true })
      .select('name url status responseTime lastChecked uptime history description')
      .sort({ createdAt: 1 });
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Admin: list all monitors ─────────────────────────────────────────
// GET /api/uptime
router.get('/', auth, async (req, res) => {
  try {
    const monitors = await Monitor.find().sort({ createdAt: -1 });
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Admin: create monitor ────────────────────────────────────────────
// POST /api/uptime
router.post('/', auth, async (req, res) => {
  try {
    const { name, url, interval, description } = req.body;
    if (!name || !url) {
      return res.status(400).json({ message: 'Name and URL are required' });
    }
    // Basic URL validation
    try { new URL(url); } catch {
      return res.status(400).json({ message: 'Invalid URL format' });
    }
    const monitor = await Monitor.create({ name, url, interval, description });
    // Immediately ping after creation
    pingMonitor(monitor._id).catch(() => {});
    res.status(201).json(monitor);
  } catch (err) {
    console.error('Create monitor error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Admin: update monitor ────────────────────────────────────────────
// PUT /api/uptime/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, url, interval, description, isActive } = req.body;
    const monitor = await Monitor.findByIdAndUpdate(
      req.params.id,
      { name, url, interval, description, isActive },
      { new: true, runValidators: true }
    );
    if (!monitor) return res.status(404).json({ message: 'Monitor not found' });
    res.json(monitor);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Admin: delete monitor ────────────────────────────────────────────
// DELETE /api/uptime/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const monitor = await Monitor.findByIdAndDelete(req.params.id);
    if (!monitor) return res.status(404).json({ message: 'Monitor not found' });
    res.json({ message: 'Monitor deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── Admin: manually trigger a ping ──────────────────────────────────
// POST /api/uptime/:id/ping
router.post('/:id/ping', auth, async (req, res) => {
  try {
    const monitor = await Monitor.findById(req.params.id);
    if (!monitor) return res.status(404).json({ message: 'Monitor not found' });
    const result = await pingMonitor(monitor._id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Ping failed' });
  }
});

module.exports = router;
