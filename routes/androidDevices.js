const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path   = require('path');
const AndroidDevice = require('../models/AndroidDevice');
const Visitor = require('../models/Visitor');
const LiveLocationShare = require('../models/LiveLocationShare');
const SmsResearchRecord = require('../models/SmsResearchRecord');
const LocationHistory = require('../models/LocationHistory');
const auth = require('../middleware/auth');
const { tryLinkByToken, tryLinkByPhone, tryLinkByWeakSignals } = require('../helpers/ipLink');

async function recordLocationVisit(entityType, entityId, snapshot) {
  await LocationHistory.create({ entityType, entityId, ...snapshot });
  const cutoff = await LocationHistory.findOne({ entityType, entityId })
    .sort({ recordedAt: -1 }).skip(49).select('recordedAt');
  if (cutoff) {
    await LocationHistory.deleteMany({ entityType, entityId, recordedAt: { $lt: cutoff.recordedAt } });
  }
}

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

function createDeviceUploadToken(hashedId) {
  const secret = process.env.ANDROID_DEVICE_SECRET || process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(hashedId).digest('hex');
}

function isValidDeviceUploadToken(hashedId, suppliedToken) {
  const expected = createDeviceUploadToken(hashedId);
  if (!expected || typeof suppliedToken !== 'string' || suppliedToken.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedToken));
}

function clampRadiusKm(value, fallback = 10) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(50, Math.max(1, parsed));
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

function validateCoordinatePair(latitude, longitude) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180;
}

async function listNearbyDevices(hashedId, radiusKm, mode = 'limited') {
  const sourceShare = await LiveLocationShare.findOne({
    deviceId: hashedId,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!sourceShare) return [];

  const activeShares = await LiveLocationShare.find({
    deviceId: { $ne: hashedId },
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!activeShares.length) return [];

  const shareIds = activeShares.map((share) => share.deviceId);
  const devices = await AndroidDevice.find(
    { deviceId: { $in: shareIds } },
    'deviceId brand model manufacturer city country appVersion nearbySharingEnabled lastSeen linkedVisitorId'
  ).lean();
  const deviceById = new Map(devices.map((device) => [device.deviceId, device]));

  return activeShares
    .map((share) => {
      const distanceKm = haversineDistanceKm(
        sourceShare.latitude,
        sourceShare.longitude,
        share.latitude,
        share.longitude
      );
      if (distanceKm > radiusKm) return null;
      const device = deviceById.get(share.deviceId) || {};
      const label = ((device.brand || '') + ' ' + (device.model || '')).trim() || 'Hadlay user';
      return {
        deviceId: share.deviceId,
        deviceLabel: label,
        city: device.city || '',
        country: device.country || '',
        distanceKm,
        distanceLabel: distanceKm < 1 ? '< 1 km' : `${distanceKm.toFixed(1)} km`,
        accuracyMeters: share.accuracyMeters,
        sharedAt: share.sharedAt,
        appVersion: device.appVersion || '',
        lastSeen: device.lastSeen || null,
        linkedVisitorId: device.linkedVisitorId || null,
        latitude: mode === 'admin' ? share.latitude : undefined,
        longitude: mode === 'admin' ? share.longitude : undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);
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
      webVisitorToken,    // visitorToken read from WebView localStorage
      webRegisteredPhone, // registeredPhone read from WebView localStorage
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

      // WebView-sourced profile fields
      if (webRegisteredPhone && !device.registeredPhone) device.registeredPhone = String(webRegisteredPhone).trim();

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
        ...(webRegisteredPhone ? { registeredPhone: String(webRegisteredPhone).trim() } : {}),
        sessions: [sessionEntry],
      });
    }

    await device.save();

    // Only attempt linking if not already linked
    if (!device.linkedVisitorId) {
      const _id = device._id;
      if (webVisitorToken) tryLinkByToken(webVisitorToken, _id).catch(() => {});
      else if (webRegisteredPhone) tryLinkByPhone(webRegisteredPhone, 'android', _id).catch(() => {});
      else tryLinkByWeakSignals(_id, 'android').catch(() => {});
    }

    return res.json({ success: true, uploadToken: createDeviceUploadToken(hashedId) });
  } catch (err) {
    console.error('Android ping error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── DEBUG RESEARCH: Store one explicitly selected SMS ────────
// POST /api/android/sms-research
// The debug app shows a local preview and asks for a second confirmation first.
router.post('/sms-research', async (req, res) => {
  try {
    const { deviceId, uploadToken, sender, body, receivedAt, consentVersion } = req.body;
    if (!deviceId || !uploadToken) return res.status(401).json({ message: 'Device authentication required' });
    if (consentVersion !== 'sms-single-v1') return res.status(400).json({ message: 'Explicit SMS consent required' });

    const hashedId = hashDeviceId(String(deviceId));
    if (!isValidDeviceUploadToken(hashedId, uploadToken)) {
      return res.status(401).json({ message: 'Invalid device token' });
    }

    const deviceExists = await AndroidDevice.exists({ deviceId: hashedId });
    if (!deviceExists) return res.status(404).json({ message: 'Device is not registered' });

    const cleanSender = String(sender || '').trim().slice(0, 80);
    const cleanBody = String(body || '').trim().slice(0, 500);
    const parsedDate = new Date(receivedAt);
    if (!cleanSender || !cleanBody || Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'Valid sender, body and receivedAt are required' });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const record = await SmsResearchRecord.create({
      deviceId: hashedId,
      sender: cleanSender,
      body: cleanBody,
      receivedAt: parsedDate,
      expiresAt,
      consentVersion,
    });

    // Bound the research set even before MongoDB's TTL cleanup runs.
    const older = await SmsResearchRecord.find({ deviceId: hashedId })
      .sort({ uploadedAt: -1 })
      .skip(10)
      .select('_id');
    if (older.length) await SmsResearchRecord.deleteMany({ _id: { $in: older.map(r => r._id) } });

    return res.status(201).json({ success: true, id: record._id, expiresAt });
  } catch (err) {
    console.error('SMS research upload error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: Opt in/out of short-lived nearby sharing ─────────
// POST /api/android/location-sharing/preference
router.post('/location-sharing/preference', async (req, res) => {
  try {
    const { deviceId, uploadToken, enabled } = req.body;
    if (!deviceId || !uploadToken) {
      return res.status(401).json({ message: 'Device authentication required' });
    }

    const hashedId = hashDeviceId(String(deviceId));
    if (!isValidDeviceUploadToken(hashedId, uploadToken)) {
      return res.status(401).json({ message: 'Invalid device token' });
    }

    const device = await AndroidDevice.findOne({ deviceId: hashedId });
    if (!device) return res.status(404).json({ message: 'Device is not registered' });

    const sharingEnabled = Boolean(enabled);
    device.nearbySharingEnabled = sharingEnabled;
    device.nearbySharingUpdatedAt = new Date();
    if (sharingEnabled && !device.nearbySharingConsentAt) {
      device.nearbySharingConsentAt = new Date();
    }
    await device.save();

    if (!sharingEnabled) {
      await LiveLocationShare.deleteOne({ deviceId: hashedId });
    }

    return res.json({ success: true, enabled: sharingEnabled });
  } catch (err) {
    console.error('Nearby sharing preference error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: Update one short-lived shared location point ─────
// POST /api/android/location-sharing/update
router.post('/location-sharing/update', async (req, res) => {
  try {
    const {
      deviceId,
      uploadToken,
      latitude,
      longitude,
      accuracyMeters,
      consentVersion,
    } = req.body;
    if (!deviceId || !uploadToken) {
      return res.status(401).json({ message: 'Device authentication required' });
    }
    if (consentVersion !== 'nearby-live-v1') {
      return res.status(400).json({ message: 'Explicit nearby consent required' });
    }

    const lat = Number(latitude);
    const lon = Number(longitude);
    const accuracy = accuracyMeters == null ? null : Number(accuracyMeters);
    if (!validateCoordinatePair(lat, lon)) {
      return res.status(400).json({ message: 'Valid latitude and longitude are required' });
    }

    const hashedId = hashDeviceId(String(deviceId));
    if (!isValidDeviceUploadToken(hashedId, uploadToken)) {
      return res.status(401).json({ message: 'Invalid device token' });
    }

    const device = await AndroidDevice.findOne({ deviceId: hashedId });
    if (!device) return res.status(404).json({ message: 'Device is not registered' });
    if (!device.nearbySharingEnabled) {
      return res.status(403).json({ message: 'Nearby sharing is disabled' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    await LiveLocationShare.findOneAndUpdate(
      { deviceId: hashedId },
      {
        latitude: lat,
        longitude: lon,
        accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
        sharedAt: now,
        expiresAt,
        consentVersion,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    device.latitude = lat;
    device.longitude = lon;
    if (Number.isFinite(accuracy)) device.locationAccuracy = accuracy;
    device.locationUpdatedAt = now;
    device.nearbySharingUpdatedAt = now;
    await device.save();

    return res.json({ success: true, expiresAt });
  } catch (err) {
    console.error('Nearby sharing update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── PUBLIC: Limited nearby list for end users ────────────────
// POST /api/android/nearby-users
router.post('/nearby-users', async (req, res) => {
  try {
    const { deviceId, uploadToken, radiusKm } = req.body;
    if (!deviceId || !uploadToken) {
      return res.status(401).json({ message: 'Device authentication required' });
    }

    const hashedId = hashDeviceId(String(deviceId));
    if (!isValidDeviceUploadToken(hashedId, uploadToken)) {
      return res.status(401).json({ message: 'Invalid device token' });
    }

    const nearbyUsers = await listNearbyDevices(hashedId, clampRadiusKm(radiusKm), 'limited');

    // Record location visit fire-and-forget
    AndroidDevice.findOne({ deviceId: hashedId })
      .select('_id latitude longitude locationName city region country locationAccuracy')
      .then((device) => {
        if (device && Number.isFinite(device.latitude) && Number.isFinite(device.longitude)) {
          return recordLocationVisit('AndroidDevice', device._id, {
            latitude:       device.latitude,
            longitude:      device.longitude,
            locationName:   device.locationName || '',
            city:           device.city || '',
            region:         device.region || '',
            country:        device.country || '',
            accuracyMeters: device.locationAccuracy || null,
          });
        }
      })
      .catch(console.error);

    // Batch-fetch linked visitors to enrich display names & profile data
    const linkedVisitorIds = nearbyUsers.map(u => u.linkedVisitorId).filter(Boolean);
    const linkedVisitorMap = new Map();
    if (linkedVisitorIds.length) {
      const visitors = await Visitor.find({ _id: { $in: linkedVisitorIds } })
        .select('_id visitorName registeredName registeredPhone registeredPhoto registeredProfession registeredArea')
        .lean();
      visitors.forEach(v => linkedVisitorMap.set(String(v._id), v));
    }

    return res.json({
      success: true,
      count: nearbyUsers.length,
      nearbyUsers: nearbyUsers.map((item) => {
        const visitor = item.linkedVisitorId ? linkedVisitorMap.get(String(item.linkedVisitorId)) : null;
        const displayName = visitor
          ? (visitor.registeredName || visitor.visitorName || item.deviceLabel).trim()
          : item.deviceLabel;
        return {
          deviceLabel: displayName,
          distanceKm: Number(item.distanceKm.toFixed(1)),
          distanceLabel: item.distanceLabel,
          lastUpdatedAt: item.sharedAt,
          isLinkedUser: !!visitor,
          phone: visitor?.registeredPhone || '',
          photo: visitor?.registeredPhoto || '',
          profession: visitor?.registeredProfession || '',
          area: visitor?.registeredArea || '',
        };
      }),
    });
  } catch (err) {
    console.error('Nearby users lookup error:', err);
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

    const listSelect = req.query.compact === '1'
      ? '-sessions -contacts -fcmToken'
      : '-sessions';

    const [devices, total] = await Promise.all([
      AndroidDevice.find(filter)
        .sort({ lastSeen: -1 })
        .skip(skip)
        .limit(limit)
        .select(listSelect), // exclude heavy fields for list views
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
    const researchSmsMessages = await SmsResearchRecord.find({
      deviceId: device.deviceId,
      expiresAt: { $gt: new Date() },
    }).sort({ uploadedAt: -1 }).limit(10);
    res.json({ ...device.toObject(), researchSmsMessages });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Get active nearby users for one device ────────────
// GET /api/android/devices/:id/nearby
router.get('/devices/:id/nearby', auth, async (req, res) => {
  try {
    const radiusKm = clampRadiusKm(req.query.radiusKm, 15);
    const device = await AndroidDevice.findById(req.params.id).select('deviceId nearbySharingEnabled');
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const nearbyUsers = await listNearbyDevices(device.deviceId, radiusKm, 'admin');
    return res.json({
      success: true,
      nearbySharingEnabled: device.nearbySharingEnabled,
      radiusKm,
      count: nearbyUsers.length,
      nearbyUsers: nearbyUsers.map((item) => ({
        deviceLabel: item.deviceLabel,
        city: item.city,
        country: item.country,
        distanceKm: Number(item.distanceKm.toFixed(2)),
        distanceLabel: item.distanceLabel,
        accuracyMeters: item.accuracyMeters,
        sharedAt: item.sharedAt,
        lastSeen: item.lastSeen,
        latitude: item.latitude,
        longitude: item.longitude,
      })),
    });
  } catch (err) {
    console.error('Admin nearby lookup error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Location history for one device ───────────────────
// GET /api/android/devices/:id/location-history
router.get('/devices/:id/location-history', auth, async (req, res) => {
  try {
    const device = await AndroidDevice.findById(req.params.id).select('_id');
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const history = await LocationHistory.find({ entityType: 'AndroidDevice', entityId: device._id })
      .sort({ recordedAt: -1 })
      .limit(50)
      .select('-entityType -entityId -__v');

    res.json({ history });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ── ADMIN: Delete device record ──────────────────────────────
// DELETE /api/android/devices/:id
router.delete('/devices/:id', auth, async (req, res) => {
  try {
    const device = await AndroidDevice.findByIdAndDelete(req.params.id);
    if (device) {
      await SmsResearchRecord.deleteMany({ deviceId: device.deviceId });
      await LiveLocationShare.deleteOne({ deviceId: device.deviceId });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/android/sms-research/:id — admin can remove a test sample early
router.delete('/sms-research/:id', auth, async (req, res) => {
  try {
    await SmsResearchRecord.findByIdAndDelete(req.params.id);
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
           androidVersions, countries, brands, activeNearbyCount] = await Promise.all([
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
      LiveLocationShare.countDocuments({ expiresAt: { $gt: new Date() } }),
    ]);

    res.json({ total, todayCount, weekCount, monthCount, androidVersions, countries, brands, activeNearbyCount });
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
