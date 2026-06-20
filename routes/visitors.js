const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Visitor = require('../models/Visitor');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');

// ---- Helper: Parse User-Agent ----
function parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', browserVersion: '', os: 'Unknown', osVersion: '', device: 'desktop' };
  
  let browser = 'Unknown', browserVersion = '', os = 'Unknown', osVersion = '', device = 'desktop';
  
  if (/Edg\/(\d+[\.\d]*)/.test(ua)) { browser = 'Edge'; browserVersion = RegExp.$1; }
  else if (/OPR\/(\d+[\.\d]*)/.test(ua)) { browser = 'Opera'; browserVersion = RegExp.$1; }
  else if (/Chrome\/(\d+[\.\d]*)/.test(ua)) { browser = 'Chrome'; browserVersion = RegExp.$1; }
  else if (/Safari\/(\d+[\.\d]*)/.test(ua) && !/Chrome/.test(ua)) { browser = 'Safari'; browserVersion = RegExp.$1; }
  else if (/Firefox\/(\d+[\.\d]*)/.test(ua)) { browser = 'Firefox'; browserVersion = RegExp.$1; }
  else if (/MSIE\s(\d+[\.\d]*)/.test(ua) || /Trident/.test(ua)) { browser = 'IE'; browserVersion = RegExp.$1 || '11'; }
  
  if (/Windows NT (\d+[\.\d]*)/.test(ua)) { os = 'Windows'; osVersion = RegExp.$1; }
  else if (/Mac OS X (\d+[_\.\d]*)/.test(ua)) { os = 'macOS'; osVersion = RegExp.$1.replace(/_/g, '.'); }
  else if (/Android (\d+[\.\d]*)/.test(ua)) { os = 'Android'; osVersion = RegExp.$1; }
  else if (/iPhone OS (\d+[_\.\d]*)/.test(ua) || /iPad/.test(ua)) { os = 'iOS'; osVersion = (RegExp.$1 || '').replace(/_/g, '.'); }
  else if (/Linux/.test(ua)) { os = 'Linux'; }
  
  if (/Mobile|Android.*Mobile|iPhone/.test(ua)) device = 'mobile';
  else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) device = 'tablet';
  
  return { browser, browserVersion, os, osVersion, device };
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

// POST - Track visitor (token-based, public)
router.post('/track', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
               || req.headers['x-real-ip'] 
               || req.connection?.remoteAddress 
               || req.ip 
               || 'unknown';
    
    const ua = req.headers['user-agent'] || '';
    const parsed = parseUserAgent(ua);
    
    const { screenWidth, screenHeight, language, timezone, referrer, platform, page, visitorToken } = req.body;
    
    console.log('🔍 /track endpoint called. visitorToken:', visitorToken ? 'present' : 'missing');
    
    let visitor = null;

    // 1. Try to find by token only (token is the persistent identity)
    if (visitorToken) {
      // Verify JWT token validity, then look up in DB
      try {
        console.log('Verifying existing JWT token...');
        jwt.verify(visitorToken, process.env.JWT_SECRET);
        visitor = await Visitor.findOne({ visitorToken });
        if (visitor) console.log('✓ Found existing visitor:', visitor.visitorName);
      } catch (jwtErr) {
        // Invalid/expired JWT — visitor is new
        console.log('Token verification failed or visitor not found');
        visitor = null;
      }
    } else {
      console.log('No token in request - will create new visitor');
    }

    if (visitor) {
      // Update existing visitor
      visitor.visitCount += 1;
      visitor.lastVisit = new Date();
      visitor.userAgent = ua;
      Object.assign(visitor, parsed);
      if (screenWidth) visitor.screenWidth = screenWidth;
      if (screenHeight) visitor.screenHeight = screenHeight;
      if (language) visitor.language = language;
      if (timezone) visitor.timezone = timezone;
      if (referrer) visitor.referrer = referrer;
      if (platform) visitor.platform = platform;
      if (page && !visitor.pages.includes(page)) visitor.pages.push(page);
      
      // Track IP address (add if not already present)
      if (ip && ip !== 'unknown' && !visitor.ipAddresses.includes(ip)) {
        visitor.ipAddresses.push(ip);
      }

      // ── Streak calculation ──────────────────────────────────
      const todayStr = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      if (visitor.lastStreakDate !== todayStr) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().slice(0, 10);
        if (visitor.lastStreakDate === yesterdayStr) {
          visitor.currentStreak = (visitor.currentStreak || 1) + 1;
        } else {
          visitor.currentStreak = 1; // streak broken
        }
        if (visitor.currentStreak > (visitor.longestStreak || 1)) {
          visitor.longestStreak = visitor.currentStreak;
        }
        visitor.lastStreakDate = todayStr;
      }
      // ───────────────────────────────────────────────────────

      // Re-issue JWT if visitor had old-format token (migration)
      if (visitor.visitorToken && !visitor.visitorToken.startsWith('eyJ')) {
        const freshToken = jwt.sign(
          { visitorName: visitor.visitorName, visitorId: visitor._id.toString() },
          process.env.JWT_SECRET
        );
        visitor.visitorToken = freshToken;
      }

      await visitor.save();

      const totalVisitors = await Visitor.countDocuments();
      return res.json({ 
        success: true, 
        totalVisitors, 
        visitorToken: visitor.visitorToken,
        visitorName: visitor.visitorName,
        visitCount: visitor.visitCount,
        currentStreak: visitor.currentStreak,
        longestStreak: visitor.longestStreak,
        needsRegistration: !visitor.isRegistered && visitor.visitCount >= 5,
        isRegistered: visitor.isRegistered
      });
    }

    // 3. Create a brand new visitor
    // Auto-generate sequential visitor name: user1, user2, ...
    try {
      console.log('Creating new visitor... JWT_SECRET available:', !!process.env.JWT_SECRET);
      
      const lastVisitor = await Visitor.findOne().sort({ createdAt: -1 }).select('visitorName');
      let nextUserNum = 1;
      if (lastVisitor?.visitorName) {
        const match = lastVisitor.visitorName.match(/user(\d+)/);
        if (match) nextUserNum = parseInt(match[1]) + 1;
      }

      const visitorName = `user${nextUserNum}`;
      console.log('Generating JWT for visitor:', visitorName);
      
      // Generate JWT token (no expiry — permanent visitor identity)
      const newToken = jwt.sign(
        { visitorName, userId: nextUserNum },
        process.env.JWT_SECRET
      );
      console.log('JWT token generated successfully:', newToken.substring(0, 50) + '...');
      
      const visitorData = {
        visitorToken: newToken,
        visitorName: visitorName,
        userAgent: ua,
        ipAddresses: ip && ip !== 'unknown' ? [ip] : [],
        ...parsed,
        screenWidth: screenWidth || null,
        screenHeight: screenHeight || null,
        language: language || '',
        timezone: timezone || '',
        referrer: referrer || '',
        platform: platform || '',
        pages: page ? [page] : [],
        currentStreak: 1,
        longestStreak: 1,
        lastStreakDate: new Date().toISOString().slice(0, 10)
      };

      // Geo lookup
      try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,city,regionName,isp`);
        if (geoRes.ok) {
          const geo = await geoRes.json();
          if (geo.status !== 'fail') {
            visitorData.country = geo.country || '';
            visitorData.city = geo.city || '';
            visitorData.region = geo.regionName || '';
            visitorData.isp = geo.isp || '';
          }
        }
      } catch (geoErr) {
        console.warn('Geo lookup failed:', geoErr.message);
      }

      console.log('Creating visitor in DB...');
      const newVisitor = await Visitor.create(visitorData);
      console.log('✓ Visitor created successfully:', newVisitor._id);
      
      const totalVisitors = await Visitor.countDocuments();
      
      const response = { 
        success: true, 
        totalVisitors, 
        visitorToken: newToken,
        visitorName: newVisitor.visitorName,
        visitCount: 1,
        currentStreak: 1,
        longestStreak: 1,
        needsRegistration: false,
        isRegistered: false
      };
      console.log('Sending response:', response);
      res.json(response);
    } catch (createErr) {
      console.error('❌ Visitor creation error:', createErr.message);
      console.error('Full error:', createErr);
      res.status(500).json({ message: 'Failed to create visitor: ' + createErr.message });
    }
  } catch (err) {
    console.error('Visitor tracking error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET - Top 10 streak leaderboard (public)
router.get('/streaks', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const top = await Visitor.find({ currentStreak: { $gte: 1 } })
      .sort({ currentStreak: -1, longestStreak: -1 })
      .limit(limit)
      .select('visitorName registeredName registeredPhoto currentStreak longestStreak lastStreakDate isRegistered');

    const leaderboard = top.map((v, i) => {
      // If last streak date is not today or yesterday, the streak is stale
      const isActive = v.lastStreakDate === today || v.lastStreakDate === yesterdayStr;
      return {
        rank: i + 1,
        name: v.isRegistered ? v.registeredName : v.visitorName,
        photo: v.registeredPhoto || null,
        currentStreak: isActive ? v.currentStreak : 0,
        longestStreak: v.longestStreak,
        isActive,
        isRegistered: v.isRegistered
      };
    }).filter(v => v.currentStreak > 0);

    res.json({ success: true, leaderboard });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST - Register visitor (after 5+ visits)
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const { visitorToken, name, phone, profession, area } = req.body;
    if (!visitorToken || !name || !phone) {
      return res.status(400).json({ message: 'Token, name & phone required' });
    }

    const visitor = await Visitor.findOne({ visitorToken });
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    visitor.otpCode = otp;
    visitor.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    visitor.registeredName = name.trim();
    visitor.registeredPhone = phone.trim();
    visitor.registeredProfession = (profession || '').trim();
    visitor.registeredArea = (area || '').trim();
    
    if (req.file) {
      visitor.registeredPhoto = req.file.path;
      visitor.registeredPhotoCloudinaryId = req.file.filename;
    }

    await visitor.save();

    // In a real app, send OTP via SMS. For now, return it directly.
    res.json({ success: true, message: 'OTP sent', otp });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST - Verify OTP and complete registration
router.post('/verify-otp', async (req, res) => {
  try {
    const { visitorToken, otp } = req.body;
    if (!visitorToken || !otp) {
      return res.status(400).json({ message: 'Token and OTP required' });
    }

    const visitor = await Visitor.findOne({ visitorToken });
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });

    if (visitor.otpCode !== otp || new Date() > visitor.otpExpiry) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    visitor.isRegistered = true;
    visitor.registeredAt = new Date();
    visitor.otpCode = null;
    visitor.otpExpiry = null;
    await visitor.save();

    res.json({ 
      success: true, 
      message: 'Registration complete',
      visitorName: visitor.registeredName,
      isRegistered: true
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET - Total visitor count (public)
// Returns sum of all visitCounts for public display
router.get('/count', async (req, res) => {
  try {
    const totalVisitors = await Visitor.countDocuments();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayVisitors = await Visitor.countDocuments({ lastVisit: { $gte: todayStart } });
    const registeredCount = await Visitor.countDocuments({ isRegistered: true });
    
    // Sum total visitCount from all visitors
    const totalVisitCountAgg = await Visitor.aggregate([
      { $group: { _id: null, totalVisitCount: { $sum: '$visitCount' } } }
    ]);
    
    const totalVisitCount = totalVisitCountAgg.length > 0 ? totalVisitCountAgg[0].totalVisitCount : 0;
    
    res.json({ 
      totalVisitors,      // For backward compatibility (unique visitor records)
      todayVisitors, 
      registeredCount,
      totalVisitCount: totalVisitCount  // NEW: Sum of all visitCounts for public UI
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET - All visitors (admin)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const visitors = await Visitor.find().sort({ lastVisit: -1 });
    res.json(visitors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET - Visitor stats (admin)  
router.get('/admin/stats', auth, async (req, res) => {
  try {
    const total = await Visitor.countDocuments();
    
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = await Visitor.countDocuments({ lastVisit: { $gte: todayStart } });
    
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const thisWeek = await Visitor.countDocuments({ lastVisit: { $gte: weekStart } });
    
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = await Visitor.countDocuments({ lastVisit: { $gte: monthStart } });

    const registered = await Visitor.countDocuments({ isRegistered: true });
    
    // Device breakdown
    const devices = await Visitor.aggregate([
      { $group: { _id: '$device', count: { $sum: 1 } } }
    ]);
    
    // Browser breakdown
    const browsers = await Visitor.aggregate([
      { $group: { _id: '$browser', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    // OS breakdown
    const osStats = await Visitor.aggregate([
      { $group: { _id: '$os', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Country breakdown
    const countries = await Visitor.aggregate([
      { $match: { country: { $ne: null, $ne: '' } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    // Recent 7 days visitor trend
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const count = await Visitor.countDocuments({ 
        lastVisit: { $gte: dayStart, $lt: dayEnd } 
      });
      last7Days.push({ 
        date: dayStart.toISOString().split('T')[0], 
        count 
      });
    }

    // Recent 30 days for monthly chart
    const last30Days = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const count = await Visitor.countDocuments({ 
        lastVisit: { $gte: dayStart, $lt: dayEnd } 
      });
      last30Days.push({ 
        date: dayStart.toISOString().split('T')[0], 
        count 
      });
    }

    // Top visitors by visit count
    const topVisitors = await Visitor.find()
      .sort({ visitCount: -1 })
      .limit(10)
      .select('visitorName visitCount isRegistered registeredName lastVisit device');

    res.json({ total, today, thisWeek, thisMonth, registered, devices, browsers, osStats, countries, last7Days, last30Days, topVisitors });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH - Set a display nickname (from streak popup name prompt)
// GET - Fetch current visitor profile by token
router.get('/me', async (req, res) => {
  try {
    const visitorToken = req.headers['x-visitor-token'] || req.query.token;
    if (!visitorToken) return res.status(400).json({ message: 'Token required' });
    const visitor = await Visitor.findOne({ visitorToken })
      .select('visitorName registeredName registeredPhone registeredPhoto registeredProfession registeredArea visitCount firstVisit lastVisit currentStreak longestStreak isRegistered city region country');
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });
    res.json({
      success: true,
      name: visitor.visitorName,
      phone: visitor.registeredPhone || '',
      photo: visitor.registeredPhoto || '',
      profession: visitor.registeredProfession || '',
      area: visitor.registeredArea || '',
      visitCount: visitor.visitCount,
      firstVisit: visitor.firstVisit,
      lastVisit: visitor.lastVisit,
      currentStreak: visitor.currentStreak,
      longestStreak: visitor.longestStreak,
      city: visitor.city || '',
      region: visitor.region || '',
      isRegistered: visitor.isRegistered
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET - Nearby visitors using saved visitor profile name and current location name
router.get('/nearby', async (req, res) => {
  try {
    const visitorToken = req.headers['x-visitor-token'] || req.query.token;
    if (!visitorToken) return res.status(400).json({ message: 'Token required' });

    const radiusKm = Math.max(1, Math.min(50, Number(req.query.radiusKm) || 10));
    const activeSince = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const currentVisitor = await Visitor.findOne({ visitorToken })
      .select('visitorName registeredName latitude longitude locationName locationUpdatedAt');
    if (!currentVisitor) return res.status(404).json({ message: 'Visitor not found' });

    const others = await Visitor.find({
      visitorToken: { $ne: visitorToken },
      latitude: { $ne: null },
      longitude: { $ne: null },
      locationUpdatedAt: { $gte: activeSince },
      locationDenied: { $ne: true }
    })
      .select('visitorName registeredName registeredProfession registeredArea latitude longitude locationName locationUpdatedAt')
      .sort({ locationUpdatedAt: -1 })
      .limit(100);

    const hasCurrentCoords = Number.isFinite(currentVisitor.latitude) && Number.isFinite(currentVisitor.longitude);

    const nearbyVisitors = others
      .map((visitor) => {
        const distanceKm = hasCurrentCoords
          ? haversineDistanceKm(
              currentVisitor.latitude,
              currentVisitor.longitude,
              visitor.latitude,
              visitor.longitude
            )
          : null;
        if (distanceKm != null && distanceKm > radiusKm) return null;

        const displayName = (visitor.registeredName || visitor.visitorName || 'Hadlay user').trim();
        return {
          name: displayName,
          profession: visitor.registeredProfession || '',
          area: visitor.registeredArea || '',
          locationName: visitor.locationName || visitor.registeredArea || 'स्थान उपलब्ध नहीं',
          distanceKm: distanceKm != null ? Number(distanceKm.toFixed(1)) : null,
          distanceLabel: distanceKm == null ? '' : (distanceKm < 1 ? '< 1 km' : `${distanceKm.toFixed(1)} km`),
          updatedAt: visitor.locationUpdatedAt
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.distanceKm == null && b.distanceKm == null) return 0;
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });

    return res.json({
      success: true,
      canMeasureDistance: hasCurrentCoords,
      currentVisitor: {
        name: (currentVisitor.registeredName || currentVisitor.visitorName || '').trim(),
        locationName: currentVisitor.locationName || ''
      },
      nearbyVisitors
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH - Update visitor profile (name, profession, area, phone)
router.patch('/profile', async (req, res) => {
  try {
    const { visitorToken, name, profession, area, phone } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'Token required' });
    const visitor = await Visitor.findOne({ visitorToken });
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });
    if (name && name.trim())       visitor.visitorName          = name.trim().slice(0, 30);
    if (profession !== undefined)  visitor.registeredProfession = profession.trim().slice(0, 50);
    if (area !== undefined)        visitor.registeredArea       = area.trim().slice(0, 50);
    if (phone !== undefined)       visitor.registeredPhone      = phone.trim().slice(0, 15);
    await visitor.save();
    res.json({ success: true, name: visitor.visitorName });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/nickname', async (req, res) => {
  try {
    const { visitorToken, nickname } = req.body;
    if (!visitorToken || !nickname || !nickname.trim()) {
      return res.status(400).json({ message: 'Token and nickname required' });
    }
    const clean = nickname.trim().slice(0, 30);
    const visitor = await Visitor.findOne({ visitorToken });
    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });
    visitor.visitorName = clean;
    await visitor.save();
    res.json({ success: true, visitorName: clean });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT - Update GPS location for visitor
router.put('/update-location', async (req, res) => {
  try {
    const { visitorToken, latitude, longitude, locationName, accuracy } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'Token required' });

    let visitor = null;
    try {
      jwt.verify(visitorToken, process.env.JWT_SECRET);
      visitor = await Visitor.findOne({ visitorToken });
    } catch (e) { /* invalid token */ }

    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });

    visitor.latitude = latitude;
    visitor.longitude = longitude;
    visitor.locationName = locationName || '';
    visitor.locationAccuracy = accuracy || null;
    visitor.locationUpdatedAt = new Date();
    visitor.locationDenied = false;
    await visitor.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT - Mark GPS permission denied
router.put('/location-denied', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'Token required' });

    let visitor = null;
    try {
      jwt.verify(visitorToken, process.env.JWT_SECRET);
      visitor = await Visitor.findOne({ visitorToken });
    } catch (e) { /* invalid token */ }

    if (visitor) {
      visitor.locationDenied = true;
      await visitor.save();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST - Track activity (clicks, page views, page switches, etc.)
router.post('/track-activity', async (req, res) => {
  try {
    const { visitorToken, events } = req.body;
    if (!visitorToken || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'Token and events required' });
    }

    let visitor = null;
    try {
      jwt.verify(visitorToken, process.env.JWT_SECRET);
      visitor = await Visitor.findOne({ visitorToken });
    } catch (e) { /* invalid token */ }

    if (!visitor) return res.status(404).json({ message: 'Visitor not found' });

    // Append activity events (cap log at 2000 entries per visitor)
    const allowed = ['page_view', 'click', 'page_switch', 'session_start', 'session_end', 'search', 'scroll', 'form_submit', 'external_link', 'other'];
    const sanitized = events.slice(0, 50).map(e => ({
      type: allowed.includes(e.type) ? e.type : 'other',
      page: (e.page || '').substring(0, 200),
      fromPage: (e.fromPage || '').substring(0, 200),
      element: (e.element || '').substring(0, 100),
      elementText: (e.elementText || '').substring(0, 80),
      elementId: (e.elementId || '').substring(0, 80),
      elementClass: (e.elementClass || '').substring(0, 100),
      value: (e.value || '').substring(0, 200),
      timeOnPage: typeof e.timeOnPage === 'number' ? e.timeOnPage : null,
      ts: e.ts ? new Date(e.ts) : new Date()
    }));

    // Update pages visited list
    sanitized.forEach(ev => {
      if ((ev.type === 'page_view' || ev.type === 'page_switch') && ev.page && !visitor.pages.includes(ev.page)) {
        visitor.pages.push(ev.page);
      }
    });

    // Accumulate total time
    const addedTime = sanitized.reduce((sum, e) => sum + (e.timeOnPage || 0), 0);
    visitor.totalTimeOnSite = (visitor.totalTimeOnSite || 0) + addedTime;

    // Keep last 2000 activity events
    visitor.activityLog = [...visitor.activityLog, ...sanitized].slice(-2000);
    await visitor.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET - Single visitor full profile (admin)
router.get('/admin/profile/:id', auth, async (req, res) => {
  try {
    const visitor = await Visitor.findById(req.params.id);
    if (!visitor) return res.status(404).json({ message: 'Not found' });
    res.json(visitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE - Delete a visitor record (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    await Visitor.findByIdAndDelete(req.params.id);
    res.json({ message: 'Visitor record deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
