const express = require('express');
const router = express.Router();
const Visitor = require('../models/Visitor');
const auth = require('../middleware/auth');

// ---- Helper: Parse User-Agent ----
function parseUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', browserVersion: '', os: 'Unknown', osVersion: '', device: 'desktop' };
  
  let browser = 'Unknown', browserVersion = '', os = 'Unknown', osVersion = '', device = 'desktop';
  
  // Detect browser
  if (/Edg\/(\d+[\.\d]*)/.test(ua)) { browser = 'Edge'; browserVersion = RegExp.$1; }
  else if (/OPR\/(\d+[\.\d]*)/.test(ua)) { browser = 'Opera'; browserVersion = RegExp.$1; }
  else if (/Chrome\/(\d+[\.\d]*)/.test(ua)) { browser = 'Chrome'; browserVersion = RegExp.$1; }
  else if (/Safari\/(\d+[\.\d]*)/.test(ua) && !/Chrome/.test(ua)) { browser = 'Safari'; browserVersion = RegExp.$1; }
  else if (/Firefox\/(\d+[\.\d]*)/.test(ua)) { browser = 'Firefox'; browserVersion = RegExp.$1; }
  else if (/MSIE\s(\d+[\.\d]*)/.test(ua) || /Trident/.test(ua)) { browser = 'IE'; browserVersion = RegExp.$1 || '11'; }
  
  // Detect OS
  if (/Windows NT (\d+[\.\d]*)/.test(ua)) { os = 'Windows'; osVersion = RegExp.$1; }
  else if (/Mac OS X (\d+[_\.\d]*)/.test(ua)) { os = 'macOS'; osVersion = RegExp.$1.replace(/_/g, '.'); }
  else if (/Android (\d+[\.\d]*)/.test(ua)) { os = 'Android'; osVersion = RegExp.$1; }
  else if (/iPhone OS (\d+[_\.\d]*)/.test(ua) || /iPad/.test(ua)) { os = 'iOS'; osVersion = (RegExp.$1 || '').replace(/_/g, '.'); }
  else if (/Linux/.test(ua)) { os = 'Linux'; }
  
  // Detect device
  if (/Mobile|Android.*Mobile|iPhone/.test(ua)) device = 'mobile';
  else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) device = 'tablet';
  
  return { browser, browserVersion, os, osVersion, device };
}

// POST - Track visitor (public)
router.post('/track', async (req, res) => {
  try {
    // Get IP from various headers (for proxies/load balancers)
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
               || req.headers['x-real-ip'] 
               || req.connection?.remoteAddress 
               || req.ip 
               || 'unknown';
    
    const ua = req.headers['user-agent'] || '';
    const parsed = parseUserAgent(ua);
    
    const { screenWidth, screenHeight, language, timezone, referrer, platform, page } = req.body;
    
    // Check if visitor already exists
    const existing = await Visitor.findOne({ ip });
    
    if (existing) {
      // Update existing visitor
      existing.visitCount += 1;
      existing.lastVisit = new Date();
      existing.userAgent = ua;
      Object.assign(existing, parsed);
      if (screenWidth) existing.screenWidth = screenWidth;
      if (screenHeight) existing.screenHeight = screenHeight;
      if (language) existing.language = language;
      if (timezone) existing.timezone = timezone;
      if (referrer) existing.referrer = referrer;
      if (platform) existing.platform = platform;
      if (page && !existing.pages.includes(page)) existing.pages.push(page);
      await existing.save();
    } else {
      // Create new visitor
      const visitorData = {
        ip,
        userAgent: ua,
        ...parsed,
        screenWidth: screenWidth || null,
        screenHeight: screenHeight || null,
        language: language || '',
        timezone: timezone || '',
        referrer: referrer || '',
        platform: platform || '',
        pages: page ? [page] : []
      };

      // Try to get geo info from IP (using free API)
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
        // Geo lookup failed, continue without it
      }

      await Visitor.create(visitorData);
    }
    
    // Return total unique visitors count
    const totalVisitors = await Visitor.countDocuments();
    res.json({ success: true, totalVisitors });
  } catch (err) {
    console.error('Visitor tracking error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET - Total visitor count (public)
router.get('/count', async (req, res) => {
  try {
    const totalVisitors = await Visitor.countDocuments();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayVisitors = await Visitor.countDocuments({ lastVisit: { $gte: todayStart } });
    res.json({ totalVisitors, todayVisitors });
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

    res.json({ total, today, thisWeek, thisMonth, devices, browsers, osStats, countries, last7Days });
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
