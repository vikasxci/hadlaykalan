const Visitor = require('../models/Visitor');
const AndroidDevice = require('../models/AndroidDevice');

const _SKIP_IPS = new Set(['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Shared: save the link bidirectionally
async function _saveLink(visitorId, deviceId, method) {
  await Promise.all([
    Visitor.updateOne({ _id: visitorId }, { $set: { linkedAndroidDeviceId: deviceId } }),
    AndroidDevice.updateOne({ _id: deviceId }, { $set: { linkedVisitorId: visitorId } }),
  ]);
  console.log(`[User-Link:${method}] Visitor ${visitorId} ↔ AndroidDevice ${deviceId}`);
}

// 1. Link by shared IP address
async function tryLinkByIp(ip, sourceType, sourceId) {
  if (!ip || _SKIP_IPS.has(ip) || ip.startsWith('::ffff:127') || ip.startsWith('192.168.') || ip.startsWith('10.')) return;
  try {
    if (sourceType === 'visitor') {
      const device = await AndroidDevice.findOne({ ipAddresses: ip, linkedVisitorId: null }).select('_id').lean();
      if (!device) return;
      await _saveLink(sourceId, device._id, 'ip');
    } else {
      const visitor = await Visitor.findOne({ ipAddresses: ip, linkedAndroidDeviceId: null }).select('_id').lean();
      if (!visitor) return;
      await _saveLink(visitor._id, sourceId, 'ip');
    }
  } catch (e) {
    console.error('[User-Link:ip]', e.message);
  }
}

// 2. Link by WebView visitorToken — most accurate, zero ambiguity
async function tryLinkByToken(webVisitorToken, deviceId) {
  if (!webVisitorToken || !deviceId) return;
  try {
    const visitor = await Visitor.findOne({ visitorToken: webVisitorToken }).select('_id linkedAndroidDeviceId').lean();
    if (!visitor) return;
    // Already linked to something — don't overwrite
    if (visitor.linkedAndroidDeviceId && String(visitor.linkedAndroidDeviceId) !== String(deviceId)) return;
    const device = await AndroidDevice.findById(deviceId).select('_id linkedVisitorId').lean();
    if (!device) return;
    if (device.linkedVisitorId && String(device.linkedVisitorId) !== String(visitor._id)) return;
    await _saveLink(visitor._id, deviceId, 'webview-token');
  } catch (e) {
    console.error('[User-Link:token]', e.message);
  }
}

// 3. Link by registered phone number equality
async function tryLinkByPhone(phone, sourceType, sourceId) {
  const cleaned = (phone || '').replace(/\D/g, '');
  if (cleaned.length < 7) return;
  try {
    if (sourceType === 'android') {
      // Device sent its registered phone; find matching visitor
      const visitor = await Visitor.findOne({
        registeredPhone: { $regex: cleaned.slice(-7) },
        linkedAndroidDeviceId: null,
      }).select('_id').lean();
      if (!visitor) return;
      const device = await AndroidDevice.findById(sourceId).select('_id linkedVisitorId').lean();
      if (!device || device.linkedVisitorId) return;
      await _saveLink(visitor._id, sourceId, 'phone');
    } else {
      // Visitor registered phone; find matching device
      const device = await AndroidDevice.findOne({
        registeredPhone: { $regex: cleaned.slice(-7) },
        linkedVisitorId: null,
      }).select('_id').lean();
      if (!device) return;
      const visitor = await Visitor.findById(sourceId).select('_id linkedAndroidDeviceId').lean();
      if (!visitor || visitor.linkedAndroidDeviceId) return;
      await _saveLink(sourceId, device._id, 'phone');
    }
  } catch (e) {
    console.error('[User-Link:phone]', e.message);
  }
}

// 4. Device fingerprint pass — run when new fingerprint data arrives (either side)
// Matches on all 4 of: screenWidth, screenHeight, language, timezone
async function tryLinkByFingerprint(sourceId, sourceType = 'android') {
  try {
    if (sourceType === 'android') {
      const device = await AndroidDevice.findById(sourceId)
        .select('_id screenWidth screenHeight language timezone linkedVisitorId').lean();
      if (!device || device.linkedVisitorId) return;
      if (!device.screenWidth || !device.screenHeight || !device.language || !device.timezone) return;
      const visitor = await Visitor.findOne({
        screenWidth: device.screenWidth, screenHeight: device.screenHeight,
        language: device.language, timezone: device.timezone,
        linkedAndroidDeviceId: null,
      }).select('_id').lean();
      if (!visitor) return;
      await _saveLink(visitor._id, sourceId, 'fingerprint');
    } else {
      const visitor = await Visitor.findById(sourceId)
        .select('_id screenWidth screenHeight language timezone linkedAndroidDeviceId').lean();
      if (!visitor || visitor.linkedAndroidDeviceId) return;
      if (!visitor.screenWidth || !visitor.screenHeight || !visitor.language || !visitor.timezone) return;
      const device = await AndroidDevice.findOne({
        screenWidth: visitor.screenWidth, screenHeight: visitor.screenHeight,
        language: visitor.language, timezone: visitor.timezone,
        linkedVisitorId: null,
      }).select('_id').lean();
      if (!device) return;
      await _saveLink(sourceId, device._id, 'fingerprint');
    }
  } catch (e) {
    console.error('[User-Link:fingerprint]', e.message);
  }
}

// 5. Location proximity — link if within 100m and within 15 minutes (either side)
async function tryLinkByLocation(sourceId, sourceType = 'android') {
  try {
    let lat, lon, updatedAt, linkedField;

    if (sourceType === 'android') {
      const device = await AndroidDevice.findById(sourceId)
        .select('_id latitude longitude locationUpdatedAt linkedVisitorId').lean();
      if (!device || device.linkedVisitorId || !device.latitude) return;
      lat = device.latitude; lon = device.longitude; updatedAt = device.locationUpdatedAt;

      const windowMs = 15 * 60 * 1000;
      const since = new Date(updatedAt.getTime() - windowMs);
      const until = new Date(updatedAt.getTime() + windowMs);
      const latD = 0.001, lonD = 0.001;
      const candidates = await Visitor.find({
        latitude:  { $gte: lat - latD, $lte: lat + latD },
        longitude: { $gte: lon - lonD, $lte: lon + lonD },
        locationUpdatedAt: { $gte: since, $lte: until },
        linkedAndroidDeviceId: null,
      }).select('_id latitude longitude').lean();

      for (const v of candidates) {
        if (haversineMeters(lat, lon, v.latitude, v.longitude) <= 100) {
          await _saveLink(v._id, sourceId, 'location');
          break;
        }
      }
    } else {
      const visitor = await Visitor.findById(sourceId)
        .select('_id latitude longitude locationUpdatedAt linkedAndroidDeviceId').lean();
      if (!visitor || visitor.linkedAndroidDeviceId || !visitor.latitude) return;
      lat = visitor.latitude; lon = visitor.longitude; updatedAt = visitor.locationUpdatedAt;

      const windowMs = 15 * 60 * 1000;
      const since = new Date(updatedAt.getTime() - windowMs);
      const until = new Date(updatedAt.getTime() + windowMs);
      const latD = 0.001, lonD = 0.001;
      const candidates = await AndroidDevice.find({
        latitude:  { $gte: lat - latD, $lte: lat + latD },
        longitude: { $gte: lon - lonD, $lte: lon + lonD },
        locationUpdatedAt: { $gte: since, $lte: until },
        linkedVisitorId: null,
      }).select('_id latitude longitude').lean();

      for (const d of candidates) {
        if (haversineMeters(lat, lon, d.latitude, d.longitude) <= 100) {
          await _saveLink(sourceId, d._id, 'location');
          break;
        }
      }
    }
  } catch (e) {
    console.error('[User-Link:location]', e.message);
  }
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

module.exports = { tryLinkByIp, tryLinkByToken, tryLinkByPhone, tryLinkByFingerprint, tryLinkByLocation };
