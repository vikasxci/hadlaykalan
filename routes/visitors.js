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
        pages: page ? [page] : []
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
// Returns unique IP count for public display, new visitors for admin
router.get('/count', async (req, res) => {
  try {
    const totalVisitors = await Visitor.countDocuments();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayVisitors = await Visitor.countDocuments({ lastVisit: { $gte: todayStart } });
    const registeredCount = await Visitor.countDocuments({ isRegistered: true });
    
    // Count unique IP addresses across all visitors
    const uniqueIPs = await Visitor.aggregate([
      { $unwind: '$ipAddresses' },
      { $match: { ipAddresses: { $ne: null, $ne: 'unknown' } } },
      { $group: { _id: '$ipAddresses' } },
      { $count: 'uniqueIPCount' }
    ]);
    
    const ipCount = uniqueIPs.length > 0 ? uniqueIPs[0].uniqueIPCount : 0;
    
    res.json({ 
      totalVisitors,      // For backward compatibility 
      todayVisitors, 
      registeredCount,
      uniqueIPCount: ipCount  // NEW: Unique IP address count for public UI
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
