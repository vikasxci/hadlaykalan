const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const UserLocation   = require('../models/UserLocation');
const Visitor        = require('../models/Visitor');
const AndroidDevice  = require('../models/AndroidDevice');

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.ip || ''
  );
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── PUBLIC: Record a web visitor's location ──────────────────
// POST /api/user-location/record
router.post('/record', async (req, res) => {
  try {
    const { latitude, longitude, accuracy, visitorToken, locationName } = req.body;

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (!isFinite(lat) || !isFinite(lon)) {
      return res.status(400).json({ message: 'Valid latitude and longitude required' });
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ message: 'Coordinates out of range' });
    }

    const ip = getClientIp(req);
    const ua = (req.headers['user-agent'] || '').slice(0, 300);

    // Resolve display name from visitor token
    let visitorId = null;
    let displayName = null;
    if (visitorToken) {
      const visitor = await Visitor.findOne({ visitorToken }).select('visitorName registeredName _id').lean();
      if (visitor) {
        visitorId = visitor._id;
        displayName = visitor.registeredName || visitor.visitorName || null;
      }
    }

    await UserLocation.create({
      source: 'web',
      visitorId,
      displayName,
      latitude: lat,
      longitude: lon,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      locationName: locationName || '',
      ip,
      userAgent: ua,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('UserLocation record error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: Record location from Android app ─────────────────
// POST /api/user-location/record-android (called from AndroidDevice ping enrichment)
router.post('/record-android', async (req, res) => {
  try {
    const { androidDeviceId, latitude, longitude, accuracy, displayName, city, region, country } = req.body;

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    if (!isFinite(lat) || !isFinite(lon)) return res.status(400).json({ message: 'Invalid coordinates' });

    await UserLocation.create({
      source: 'android',
      androidDeviceId: androidDeviceId || null,
      displayName: displayName || null,
      latitude: lat,
      longitude: lon,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      city: city || '',
      region: region || '',
      country: country || '',
      ip: getClientIp(req),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: List all recorded locations ───────────────────────
// GET /api/user-location?page=1&limit=50&source=web&adminLat=xx&adminLon=yy
router.get('/', auth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.source === 'web' || req.query.source === 'android') {
      filter.source = req.query.source;
    }

    const adminLat = parseFloat(req.query.adminLat);
    const adminLon = parseFloat(req.query.adminLon);
    const hasAdminPos = isFinite(adminLat) && isFinite(adminLon);

    const [records, total] = await Promise.all([
      UserLocation.find(filter)
        .sort({ recordedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('visitorId',       'registeredName visitorName registeredPhone')
        .populate('androidDeviceId', 'brand model adminLabel linkedVisitorId')
        .lean(),
      UserLocation.countDocuments(filter),
    ]);

    const enriched = records.map(r => {
      // Best display name: model displayName → populated visitor → device label
      let name = r.displayName;
      if (!name && r.visitorId) {
        name = r.visitorId.registeredName || r.visitorId.visitorName || null;
      }
      if (!name && r.androidDeviceId) {
        name = r.androidDeviceId.adminLabel ||
          `${r.androidDeviceId.brand || ''} ${r.androidDeviceId.model || ''}`.trim() || null;
      }

      const distanceKm = hasAdminPos
        ? parseFloat(haversineKm(adminLat, adminLon, r.latitude, r.longitude).toFixed(2))
        : null;

      return {
        _id:         r._id,
        source:      r.source,
        name:        name || '—',
        phone:       r.visitorId?.registeredPhone || '',
        latitude:    r.latitude,
        longitude:   r.longitude,
        accuracy:    r.accuracy,
        city:        r.city,
        region:      r.region,
        country:     r.country,
        locationName: r.locationName,
        ip:          r.ip,
        recordedAt:  r.recordedAt,
        distanceKm,
      };
    });

    res.json({ records: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('UserLocation list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Stats summary ─────────────────────────────────────
// GET /api/user-location/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const week  = new Date(today); week.setDate(today.getDate() - 7);

    const [total, todayCount, weekCount, webCount, androidCount] = await Promise.all([
      UserLocation.countDocuments(),
      UserLocation.countDocuments({ recordedAt: { $gte: today } }),
      UserLocation.countDocuments({ recordedAt: { $gte: week } }),
      UserLocation.countDocuments({ source: 'web' }),
      UserLocation.countDocuments({ source: 'android' }),
    ]);

    res.json({ total, todayCount, weekCount, webCount, androidCount });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Delete a single record ────────────────────────────
// DELETE /api/user-location/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await UserLocation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
