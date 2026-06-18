const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path   = require('path');
const AndroidDevice = require('../models/AndroidDevice');
const auth = require('../middleware/auth');

// ── Firebase Admin SDK init (v12+ modular API) ─────────────
let _messaging = null;

function getMessagingInstance() {
  if (_messaging) return _messaging;
  try {
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    const fs   = require('fs');
    const saPath = path.join(__dirname, '../firebase-service-account.json');

    let app;
    if (getApps().length > 0) {
      // Already initialized (e.g. by another require)
      app = getApps()[0];
    } else if (fs.existsSync(saPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      app = initializeApp({ credential: cert(serviceAccount) });
      console.log('[FCM] Firebase Admin initialized with service account file');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      app = initializeApp({ credential: cert(serviceAccount) });
      console.log('[FCM] Firebase Admin initialized with env JSON');
    } else {
      throw new Error('No Firebase service account found. Place firebase-service-account.json in Admin/ folder or set FIREBASE_SERVICE_ACCOUNT_JSON env var.');
    }

    _messaging = getMessaging(app);
    return _messaging;
  } catch (err) {
    console.error('[FCM] Firebase Admin init error:', err.message);
    throw err;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

function hashDeviceId(rawId) {
  return crypto.createHash('sha256').update(rawId).digest('hex');
}

async function lookupIp(ip) {
  if (!ip || ip === 'unknown' || ip.startsWith('::') || ip === '127.0.0.1') return {};
  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=country,regionName,city,isp`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    if (data.status === 'fail') return {};
    return { country: data.country || '', region: data.regionName || '', city: data.city || '', isp: data.isp || '' };
  } catch { return {}; }
}

// Send FCM push to a single token via Firebase Admin SDK
async function sendFcmToToken(fcmToken, title, body, data = {}) {
  const messaging = getMessagingInstance();
  const stringData = {};
  for (const [k, v] of Object.entries(data)) stringData[k] = String(v);

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: stringData,
    android: {
      priority: 'high',
      notification: { channelId: 'hadlay_default', sound: 'default' },
    },
  };
  return messaging.send(message);
}

// Send to a list of tokens in batches of 500
async function sendFcmMulticast(tokens, title, body, data = {}) {
  if (!tokens.length) return { success: 0, failure: 0 };
  const messaging = getMessagingInstance();
  const stringData = {};
  for (const [k, v] of Object.entries(data)) stringData[k] = String(v);

  const BATCH = 500;
  let success = 0, failure = 0;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: { title, body },
        data: stringData,
        android: {
          priority: 'high',
          notification: { channelId: 'hadlay_default', sound: 'default' },
        },
      });
      success += response.successCount;
      failure += response.failureCount;
    } catch (err) {
      console.error('[FCM] Batch send error:', err.message);
      failure += batch.length;
    }
  }
  return { success, failure };
}

// Attach helpers to router so they survive the `module.exports = router` below
router.sendFcmMulticast = sendFcmMulticast;
router.sendFcmToToken   = sendFcmToToken;

// ── PUBLIC: App sends ping on launch ────────────────────────
// POST /api/android/ping
router.post('/ping', async (req, res) => {
  try {
    const {
      deviceId,       // raw Android ID (we hash it immediately)
      fcmToken,       // Firebase Cloud Messaging token
      brand, manufacturer, model, product,
      androidVersion, sdkVersion, appVersion,
      screenWidth, screenHeight, density,
      language, timezone,
      latitude, longitude, locationAccuracy, locationName,
      contactCount, contacts,
    } = req.body;

    if (!deviceId) return res.status(400).json({ message: 'deviceId required' });

    const hashedId = hashDeviceId(String(deviceId));
    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';

    // Geo lookup (non-blocking — we await but don't fail if it errors)
    const geo = await lookupIp(ip);

    let device = await AndroidDevice.findOne({ deviceId: hashedId });

    const sessionEntry = {
      sessionStart: new Date(),
      ip,
      country: geo.country || '',
      city:    geo.city    || '',
      region:  geo.region  || '',
      isp:     geo.isp     || '',
      appVersion: appVersion || '',
    };

    if (device) {
      // Update duration of previous session
      if (device.sessions.length > 0) {
        const last = device.sessions[device.sessions.length - 1];
        if (!last.sessionEnd) {
          last.sessionEnd = new Date();
          last.durationMs = last.sessionEnd - last.sessionStart;
        }
      }

      device.visitCount  += 1;
      device.lastSeen     = new Date();
      device.userAgent    = ua;
      device.appVersion   = appVersion || device.appVersion;
      device.androidVersion = androidVersion || device.androidVersion;
      device.sdkVersion   = sdkVersion   || device.sdkVersion;
      device.screenWidth  = screenWidth  || device.screenWidth;
      device.screenHeight = screenHeight || device.screenHeight;
      device.density      = density      || device.density;
      device.language     = language     || device.language;
      device.timezone     = timezone     || device.timezone;

      // FCM token update
      if (fcmToken && fcmToken !== device.fcmToken) {
        device.fcmToken = fcmToken;
        device.fcmTokenUpdatedAt = new Date();
        device.notificationsEnabled = true;
      }

      // Merge geo fields if resolved
      if (geo.country) { device.country = geo.country; device.region = geo.region; device.city = geo.city; device.isp = geo.isp; }

      // Store IP if new
      if (ip && ip !== 'unknown' && !device.ipAddresses.includes(ip)) {
        device.ipAddresses.push(ip);
      }

      // GPS update
      if (latitude != null && longitude != null) {
        device.latitude    = latitude;
        device.longitude   = longitude;
        if (locationAccuracy != null) device.locationAccuracy = locationAccuracy;
        device.locationName = locationName || device.locationName;
        device.locationUpdatedAt = new Date();
      }

      // Contacts update
      if (contactCount != null) device.contactCount = contactCount;
      if (Array.isArray(contacts) && contacts.length > 0) device.contacts = contacts;

      device.sessions.push(sessionEntry);
    } else {
      device = new AndroidDevice({
        deviceId: hashedId,
        brand, manufacturer, model, product,
        androidVersion, sdkVersion, appVersion,
        screenWidth, screenHeight, density,
        language, timezone,
        ...(fcmToken ? { fcmToken, fcmTokenUpdatedAt: new Date(), notificationsEnabled: true } : {}),
        userAgent: ua,
        ipAddresses: ip && ip !== 'unknown' ? [ip] : [],
        country: geo.country || '',
        region:  geo.region  || '',
        city:    geo.city    || '',
        isp:     geo.isp     || '',
        ...(latitude != null && longitude != null ? {
          latitude, longitude, locationAccuracy: locationAccuracy || null,
          locationName, locationUpdatedAt: new Date(),
        } : {}),
        contactCount: contactCount != null ? contactCount : null,
        contacts: Array.isArray(contacts) ? contacts : [],
        sessions: [sessionEntry],
      });
    }

    await device.save();
    return res.json({ success: true });
  } catch (err) {
    console.error('Android ping error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Get all Android devices ───────────────────────────
// GET /api/android/devices
router.get('/devices', auth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.search) {
      const q = new RegExp(req.query.search, 'i');
      filter.$or = [
        { brand: q }, { model: q }, { country: q },
        { city: q },  { isp: q },   { appVersion: q },
      ];
    }

    const [devices, total] = await Promise.all([
      AndroidDevice.find(filter)
        .sort({ lastSeen: -1 })
        .skip(skip)
        .limit(limit)
        .select('-sessions'), // exclude sessions for list view
      AndroidDevice.countDocuments(filter),
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

    const [todayCount, weekCount] = await Promise.all([
      AndroidDevice.countDocuments({ lastSeen: { $gte: today } }),
      AndroidDevice.countDocuments({ lastSeen: { $gte: weekAgo } }),
    ]);

    res.json({
      devices,
      total,
      todayCount,
      weekCount,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Android devices list error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Get single device with sessions ───────────────────
// GET /api/android/devices/:id
router.get('/devices/:id', auth, async (req, res) => {
  try {
    const device = await AndroidDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    res.json(device);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Delete device record ──────────────────────────────
// DELETE /api/android/devices/:id
router.delete('/devices/:id', auth, async (req, res) => {
  try {
    await AndroidDevice.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Stats summary ─────────────────────────────────────
// GET /api/android/stats
router.get('/stats', auth, async (req, res) => {
  try {
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);

    const [total, todayCount, weekCount, monthCount,
           androidVersions, countries, brands] = await Promise.all([
      AndroidDevice.countDocuments(),
      AndroidDevice.countDocuments({ lastSeen: { $gte: today } }),
      AndroidDevice.countDocuments({ lastSeen: { $gte: weekAgo } }),
      AndroidDevice.countDocuments({ lastSeen: { $gte: monthAgo } }),
      AndroidDevice.aggregate([
        { $group: { _id: '$androidVersion', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]),
      AndroidDevice.aggregate([
        { $match: { country: { $ne: '' } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]),
      AndroidDevice.aggregate([
        { $group: { _id: '$brand', count: { $sum: 1 } } },
        { $sort: { count: -1 } }, { $limit: 8 }
      ]),
    ]);

    res.json({ total, todayCount, weekCount, monthCount, androidVersions, countries, brands });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: App registers / refreshes FCM token ──────────────
// POST /api/android/fcm-token
router.post('/fcm-token', async (req, res) => {
  try {
    const { deviceId, fcmToken } = req.body;
    if (!deviceId || !fcmToken) return res.status(400).json({ message: 'deviceId and fcmToken required' });
    const hashedId = hashDeviceId(String(deviceId));
    await AndroidDevice.findOneAndUpdate(
      { deviceId: hashedId },
      { fcmToken, fcmTokenUpdatedAt: new Date(), notificationsEnabled: true },
      { upsert: false }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Get token subscriber count ────────────────────────
// GET /api/android/notify/count
router.get('/notify/count', auth, async (req, res) => {
  try {
    const count = await AndroidDevice.countDocuments({ fcmToken: { $ne: null }, notificationsEnabled: true });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Send push notification to all app users ───────────
// POST /api/android/notify
router.post('/notify', auth, async (req, res) => {
  try {
    const { title, body, data } = req.body;
    if (!title || !body) return res.status(400).json({ message: 'title and body required' });

    // Check Firebase is configured before querying devices
    let messaging;
    try {
      messaging = getMessagingInstance();
    } catch (fcmErr) {
      return res.status(503).json({ message: 'Push notifications not configured on this server. Set FIREBASE_SERVICE_ACCOUNT_JSON env var.' });
    }

    const devices = await AndroidDevice.find(
      { fcmToken: { $exists: true, $ne: null } },
      'fcmToken'
    );
    const tokens = devices.map(d => d.fcmToken).filter(Boolean);

    if (!tokens.length) {
      return res.json({ success: true, message: 'No devices with push token registered', sent: 0, failed: 0 });
    }

    const result = await sendFcmMulticast(tokens, title, body, data || {});
    res.json({ success: true, sent: result.success, failed: result.failure, total: tokens.length });
  } catch (err) {
    console.error('Android notify error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// POST /api/android/notify/test-weather  — send immediate weather notification (admin only)
router.post('/notify/test-weather', auth, async (req, res) => {
  try {
    const { sendWeatherNotification } = require('../services/weatherNotificationCron');
    const type = req.body.type === 'evening' ? 'evening' : 'morning';
    await sendWeatherNotification(type);
    res.json({ success: true, message: `${type} weather notification sent` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
