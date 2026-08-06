const express = require('express');
const router = express.Router();
const PopupMessage = require('../models/PopupMessage');
const PopupResponse = require('../models/PopupResponse');
const Visitor = require('../models/Visitor');
const AndroidDevice = require('../models/AndroidDevice');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// ---- Helpers ----------------------------------------------------------

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || req.connection?.remoteAddress
      || req.ip
      || 'unknown';
}

function detectPlatform(req, bodyPlatform) {
  if (bodyPlatform === 'app' || bodyPlatform === 'web') return bodyPlatform;
  const ua = req.headers['user-agent'] || '';
  return /HadlayKalanApp/i.test(ua) ? 'app' : 'web';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Where each `saveTo` lands on the Visitor / AndroidDevice document.
// 'name' writes both the display name and the registered name so the
// header, nearby list and admin tables all pick it up.
const PROFILE_TARGETS = {
  name:       ['visitorName', 'registeredName'],
  phone:      ['registeredPhone'],
  profession: ['registeredProfession'],
  area:       ['registeredArea']
};

function normalisePhone(val) {
  return String(val || '').replace(/\D/g, '').slice(-10);
}

// Validates one answer against its field definition.
// Returns an error string, or '' when the value is acceptable.
function validateAnswer(field, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return field.required ? `${field.label} is required` : '';
  if (field.type === 'tel') {
    const digits = normalisePhone(value);
    if (digits.length !== 10 || !/^[6-9]/.test(digits)) return `${field.label}: invalid mobile number`;
  }
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `${field.label}: invalid email`;
  }
  if (field.type === 'number' && isNaN(Number(value))) return `${field.label}: must be a number`;
  if (field.type === 'select' && field.options?.length && !field.options.includes(value)) {
    return `${field.label}: invalid choice`;
  }
  if (value.length > 500) return `${field.label}: too long`;
  return '';
}

// Strips internal/admin-only fields before sending a popup to a user
function publicPopup(p) {
  return {
    _id: p._id,
    title: p.title,
    message: p.message,
    emoji: p.emoji,
    image: p.image,
    displayType: p.displayType,
    collectInfo: p.collectInfo,
    fields: (p.fields || []).map(f => ({
      key: f.key, label: f.label, type: f.type,
      placeholder: f.placeholder, required: f.required, options: f.options,
      saveTo: f.saveTo
    })),
    ctaText: p.ctaText,
    ctaUrl: p.ctaUrl,
    dismissText: p.dismissText,
    delaySeconds: p.delaySeconds
  };
}

// Parses the `fields` payload coming from the admin form (JSON string)
function parseFields(rawFields) {
  if (!rawFields) return [];
  let parsed = rawFields;
  if (typeof rawFields === 'string') {
    try { parsed = JSON.parse(rawFields); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(f => f && f.key && f.label)
    .map(f => ({
      key: String(f.key).trim().slice(0, 40),
      label: String(f.label).trim().slice(0, 80),
      type: ['text', 'tel', 'email', 'number', 'textarea', 'select'].includes(f.type) ? f.type : 'text',
      placeholder: String(f.placeholder || '').slice(0, 80),
      required: f.required === true || f.required === 'true',
      options: Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 60)).filter(Boolean) : [],
      saveTo: ['name', 'phone', 'profession', 'area', 'none'].includes(f.saveTo) ? f.saveTo : 'none'
    }))
    .slice(0, 10);
}

function bool(val, fallback = false) {
  if (val === undefined || val === null || val === '') return fallback;
  return val === true || val === 'true' || val === 'on' || val === '1';
}

// ---- PUBLIC: fetch the popup this user should see now -----------------
// GET /api/popups/active?visitorToken=..&deviceId=..&platform=..
router.get('/active', async (req, res) => {
  try {
    const visitorToken = req.query.visitorToken || req.headers['x-visitor-token'] || '';
    const deviceId     = req.query.deviceId || '';
    const platform     = detectPlatform(req, req.query.platform);

    if (!visitorToken && !deviceId) return res.json({ popup: null });

    const now = new Date();
    const candidates = await PopupMessage.find({
      isActive: true,
      $and: [
        { $or: [{ startAt: null }, { startAt: { $exists: false } }, { startAt: { $lte: now } }] },
        { $or: [{ endAt: null },   { endAt: { $exists: false } },   { endAt: { $gte: now } }] }
      ]
    }).sort({ priority: -1, createdAt: -1 }).limit(20);

    if (!candidates.length) return res.json({ popup: null });

    // Only look the visitor up when an audience rule actually needs it
    let visitor = null;
    const needsProfile = candidates.some(p => p.audience === 'registered' || p.audience === 'unregistered');
    if (needsProfile && visitorToken) {
      visitor = await Visitor.findOne({ visitorToken }).select('isRegistered registeredPhone registeredName visitorName');
    }

    const identity = visitorToken ? { visitorToken } : { deviceId };

    for (const p of candidates) {
      // ── Audience ──
      if (p.audience === 'web' && platform !== 'web') continue;
      if (p.audience === 'app' && platform !== 'app') continue;
      if (p.audience === 'registered' || p.audience === 'unregistered') {
        const isRegistered = !!(visitor && (visitor.isRegistered || visitor.registeredPhone));
        if (p.audience === 'registered' && !isRegistered) continue;
        if (p.audience === 'unregistered' && isRegistered) continue;
      }

      // ── Frequency ──
      if (p.frequency !== 'every_visit') {
        const query = { popup: p._id, ...identity };
        if (p.frequency === 'until_submitted') {
          // A dismissal does not count — keep asking until they answer
          query.action = { $in: ['submitted', 'acknowledged'] };
        } else if (p.frequency === 'once_per_day') {
          query.updatedAt = { $gte: startOfToday() };
        }
        const seen = await PopupResponse.exists(query);
        if (seen) continue;
      }

      return res.json({ popup: publicPopup(p) });
    }

    res.json({ popup: null });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- PUBLIC: count a view --------------------------------------------
// POST /api/popups/:id/view
router.post('/:id/view', async (req, res) => {
  try {
    await PopupMessage.updateOne({ _id: req.params.id }, { $inc: { viewCount: 1 } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- PUBLIC: submit / acknowledge / dismiss ---------------------------
// POST /api/popups/:id/respond
router.post('/:id/respond', async (req, res) => {
  try {
    const { visitorToken = '', deviceId = '', data = {}, page = '' } = req.body;
    const action   = ['submitted', 'acknowledged', 'dismissed'].includes(req.body.action) ? req.body.action : 'submitted';
    const platform = detectPlatform(req, req.body.platform);

    if (!visitorToken && !deviceId) {
      return res.status(400).json({ message: 'visitorToken or deviceId required' });
    }

    const popup = await PopupMessage.findById(req.params.id);
    if (!popup) return res.status(404).json({ message: 'Popup not found' });

    // A blocking popup can never be dismissed
    if (action === 'dismissed' && popup.displayType === 'non_closable') {
      return res.status(400).json({ message: 'This message cannot be dismissed' });
    }

    // ── Validate answers ──
    const answers = [];
    let savedName = '', savedPhone = '';
    if (action === 'submitted' && popup.collectInfo) {
      const errors = [];
      for (const field of popup.fields) {
        const err = validateAnswer(field, data[field.key]);
        if (err) { errors.push(err); continue; }
        const value = String(data[field.key] ?? '').trim();
        if (!value) continue;
        const clean = field.type === 'tel' ? normalisePhone(value) : value.slice(0, 500);
        answers.push({ key: field.key, label: field.label, value: clean });
        if (field.saveTo === 'name')  savedName  = clean;
        if (field.saveTo === 'phone') savedPhone = clean;
      }
      if (errors.length) return res.status(400).json({ message: errors[0], errors });
    }

    // ── Persist answers onto the user's profile ──
    let visitorDoc = null, deviceDoc = null;
    if (answers.length) {
      const updates = {};
      for (const field of popup.fields) {
        if (field.saveTo === 'none') continue;
        const answer = answers.find(a => a.key === field.key);
        if (!answer) continue;
        for (const target of PROFILE_TARGETS[field.saveTo] || []) updates[target] = answer.value;
      }

      if (Object.keys(updates).length) {
        if (visitorToken) {
          visitorDoc = await Visitor.findOne({ visitorToken });
          if (visitorDoc) {
            Object.assign(visitorDoc, updates);
            if (updates.registeredPhone && !visitorDoc.isRegistered) {
              visitorDoc.isRegistered = true;
              visitorDoc.registeredAt = visitorDoc.registeredAt || new Date();
            }
            await visitorDoc.save();
          }
        }
        if (deviceId) {
          // AndroidDevice has no visitorName — drop it from the update
          const { visitorName, ...deviceUpdates } = updates;
          deviceDoc = await AndroidDevice.findOneAndUpdate(
            { deviceId },
            { $set: deviceUpdates },
            { new: true }
          );
        }
      }
    }

    // ── Record the response (one row per user per popup) ──
    const filter = { popup: popup._id, ...(visitorToken ? { visitorToken } : { deviceId }) };
    const existing = await PopupResponse.findOne(filter);

    const payload = {
      popup: popup._id,
      visitorToken: visitorToken || undefined,
      deviceId: deviceId || undefined,
      visitor: visitorDoc?._id || existing?.visitor || null,
      androidDevice: deviceDoc?._id || existing?.androidDevice || null,
      platform,
      action,
      name:  savedName  || existing?.name  || '',
      phone: savedPhone || existing?.phone || '',
      answers: answers.length ? answers : (existing?.answers || []),
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || '',
      page: String(page).slice(0, 200)
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
    } else {
      await PopupResponse.create(payload);
    }

    // ── Stats ──
    const inc = action === 'dismissed' ? { dismissCount: 1 } : { submitCount: 1 };
    await PopupMessage.updateOne({ _id: popup._id }, { $inc: inc });

    res.json({ success: true, ctaUrl: popup.ctaUrl || '' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: list all popups ------------------------------------------
router.get('/admin/all', auth, async (req, res) => {
  try {
    const popups = await PopupMessage.find().sort({ isActive: -1, priority: -1, createdAt: -1 });
    const counts = await PopupResponse.aggregate([
      { $match: { action: { $in: ['submitted', 'acknowledged'] } } },
      { $group: { _id: '$popup', total: { $sum: 1 } } }
    ]);
    const byPopup = Object.fromEntries(counts.map(c => [String(c._id), c.total]));
    res.json(popups.map(p => ({ ...p.toObject(), responseCount: byPopup[String(p._id)] || 0 })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: responses for one popup (JSON or CSV) --------------------
router.get('/admin/:id/responses', auth, async (req, res) => {
  try {
    const responses = await PopupResponse.find({ popup: req.params.id })
      .sort({ updatedAt: -1 })
      .limit(Math.min(parseInt(req.query.limit) || 500, 2000))
      .lean();

    if (req.query.format === 'csv') {
      const keys = [...new Set(responses.flatMap(r => (r.answers || []).map(a => a.key)))];
      const header = ['Date', 'Platform', 'Action', ...keys, 'IP'];
      const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = responses.map(r => [
        new Date(r.updatedAt).toISOString(),
        r.platform,
        r.action,
        ...keys.map(k => (r.answers || []).find(a => a.key === k)?.value || ''),
        r.ip || ''
      ].map(escape).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="popup-responses-${req.params.id}.csv"`);
      return res.send('﻿' + [header.map(escape).join(','), ...rows].join('\n'));
    }

    res.json(responses);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: single popup ---------------------------------------------
router.get('/admin/:id', auth, async (req, res) => {
  try {
    const popup = await PopupMessage.findById(req.params.id);
    if (!popup) return res.status(404).json({ message: 'Popup not found' });
    res.json(popup);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: create ----------------------------------------------------
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const b = req.body;
    const popup = new PopupMessage({
      title: b.title,
      message: b.message,
      emoji: b.emoji || '📢',
      displayType: b.displayType === 'non_closable' ? 'non_closable' : 'closable',
      collectInfo: bool(b.collectInfo),
      fields: bool(b.collectInfo) ? parseFields(b.fields) : [],
      ctaText: b.ctaText || 'ठीक है / OK',
      ctaUrl: b.ctaUrl || '',
      dismissText: b.dismissText || 'बाद में / Later',
      audience: b.audience || 'all',
      frequency: b.frequency || 'once',
      delaySeconds: Math.max(0, parseInt(b.delaySeconds) || 0),
      startAt: b.startAt || null,
      endAt: b.endAt || null,
      priority: parseInt(b.priority) || 0,
      isActive: bool(b.isActive, true),
      createdBy: req.admin?.email || 'Admin'
    });

    if (bool(b.collectInfo) && !popup.fields.length) {
      return res.status(400).json({ message: 'Add at least one field when collecting info' });
    }
    if (req.file) {
      popup.image = req.file.path;
      popup.cloudinaryId = req.file.filename;
    }

    await popup.save();
    res.status(201).json(popup);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: update ----------------------------------------------------
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const popup = await PopupMessage.findById(req.params.id);
    if (!popup) return res.status(404).json({ message: 'Popup not found' });
    const b = req.body;

    if (req.file) {
      if (popup.cloudinaryId) await cloudinary.uploader.destroy(popup.cloudinaryId);
      popup.image = req.file.path;
      popup.cloudinaryId = req.file.filename;
    }

    if (b.title   !== undefined) popup.title = b.title;
    if (b.message !== undefined) popup.message = b.message;
    if (b.emoji   !== undefined) popup.emoji = b.emoji;
    if (b.displayType !== undefined) popup.displayType = b.displayType === 'non_closable' ? 'non_closable' : 'closable';
    if (b.collectInfo !== undefined) popup.collectInfo = bool(b.collectInfo);
    if (b.fields  !== undefined) popup.fields = popup.collectInfo ? parseFields(b.fields) : [];
    if (b.ctaText !== undefined) popup.ctaText = b.ctaText;
    if (b.ctaUrl  !== undefined) popup.ctaUrl = b.ctaUrl;
    if (b.dismissText !== undefined) popup.dismissText = b.dismissText;
    if (b.audience  !== undefined) popup.audience = b.audience;
    if (b.frequency !== undefined) popup.frequency = b.frequency;
    if (b.delaySeconds !== undefined) popup.delaySeconds = Math.max(0, parseInt(b.delaySeconds) || 0);
    if (b.startAt  !== undefined) popup.startAt = b.startAt || null;
    if (b.endAt    !== undefined) popup.endAt = b.endAt || null;
    if (b.priority !== undefined) popup.priority = parseInt(b.priority) || 0;
    if (b.isActive !== undefined) popup.isActive = bool(b.isActive, true);

    if (popup.collectInfo && !popup.fields.length) {
      return res.status(400).json({ message: 'Add at least one field when collecting info' });
    }

    await popup.save();
    res.json(popup);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: toggle active --------------------------------------------
router.patch('/:id/toggle', auth, async (req, res) => {
  try {
    const popup = await PopupMessage.findById(req.params.id);
    if (!popup) return res.status(404).json({ message: 'Popup not found' });
    popup.isActive = !popup.isActive;
    await popup.save();
    res.json({ success: true, isActive: popup.isActive });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: reset who has seen it (re-show to everyone) --------------
router.post('/:id/reset', auth, async (req, res) => {
  try {
    const result = await PopupResponse.deleteMany({ popup: req.params.id });
    await PopupMessage.updateOne({ _id: req.params.id }, { $set: { viewCount: 0, submitCount: 0, dismissCount: 0 } });
    res.json({ success: true, cleared: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- ADMIN: delete ----------------------------------------------------
router.delete('/:id', auth, async (req, res) => {
  try {
    const popup = await PopupMessage.findById(req.params.id);
    if (!popup) return res.status(404).json({ message: 'Popup not found' });
    if (popup.cloudinaryId) await cloudinary.uploader.destroy(popup.cloudinaryId);
    await PopupResponse.deleteMany({ popup: popup._id });
    await popup.deleteOne();
    res.json({ message: 'Popup deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
