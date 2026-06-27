const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const UserLocation = require('../models/UserLocation');
const Visitor      = require('../models/Visitor');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoords(latitude, longitude) {
  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// ── PUBLIC: Record web visitor location ──────────────────────
// POST /api/user-location/record
router.post('/record', async (req, res) => {
  try {
    const { latitude, longitude, accuracy, visitorToken, locationName } = req.body;

    const coords = parseCoords(latitude, longitude);
    if (!coords) return res.status(400).json({ message: 'Valid latitude and longitude required' });

    let visitorId = null;
    let displayName = null;
    if (visitorToken) {
      const visitor = await Visitor.findOne({ visitorToken })
        .select('visitorName registeredName _id').lean();
      if (visitor) {
        visitorId = visitor._id;
        displayName = visitor.registeredName || visitor.visitorName || null;
      }
    }

    await UserLocation.create({
      source: 'web',
      visitorId,
      displayName,
      latitude: coords.lat,
      longitude: coords.lon,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      locationName: locationName || '',
    });

    res.json({ success: true });
  } catch (err) {
    console.error('UserLocation record error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: Record Android app user location ──────────────────
// POST /api/user-location/record-android
router.post('/record-android', async (req, res) => {
  try {
    const { latitude, longitude, accuracy, visitorToken, displayName, city, region, country, locationName } = req.body;

    const coords = parseCoords(latitude, longitude);
    if (!coords) return res.status(400).json({ message: 'Invalid coordinates' });

    // Resolve visitor identity same as web — android app may pass a visitorToken
    let visitorId = null;
    let resolvedName = displayName || null;
    if (visitorToken) {
      const visitor = await Visitor.findOne({ visitorToken })
        .select('visitorName registeredName _id').lean();
      if (visitor) {
        visitorId = visitor._id;
        resolvedName = resolvedName || visitor.registeredName || visitor.visitorName || null;
      }
    }

    await UserLocation.create({
      source: 'android',
      visitorId,
      displayName: resolvedName,
      latitude: coords.lat,
      longitude: coords.lon,
      accuracy: accuracy ? parseFloat(accuracy) : null,
      locationName: locationName || '',
      city: city || '',
      region: region || '',
      country: country || '',
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
        .populate('visitorId', 'registeredName visitorName registeredPhone')
        .lean(),
      UserLocation.countDocuments(filter),
    ]);

    const enriched = records.map(r => {
      const name = r.displayName ||
        r.visitorId?.registeredName ||
        r.visitorId?.visitorName ||
        '—';

      const distanceKm = hasAdminPos
        ? parseFloat(haversineKm(adminLat, adminLon, r.latitude, r.longitude).toFixed(2))
        : null;

      return {
        _id:          r._id,
        source:       r.source,
        name,
        phone:        r.visitorId?.registeredPhone || '',
        latitude:     r.latitude,
        longitude:    r.longitude,
        accuracy:     r.accuracy,
        locationName: r.locationName,
        city:         r.city,
        region:       r.region,
        country:      r.country,
        recordedAt:   r.recordedAt,
        distanceKm,
      };
    });

    res.json({ records: enriched, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('UserLocation list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Stats summary ──────────────────────────────────────
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
