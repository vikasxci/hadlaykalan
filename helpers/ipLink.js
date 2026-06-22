const Visitor = require('../models/Visitor');
const AndroidDevice = require('../models/AndroidDevice');

const _SKIP_IPS = new Set(['unknown', '127.0.0.1', '::1', '::ffff:127.0.0.1']);

// ── Save the link bidirectionally ────────────────────────────
async function _saveLink(visitorId, deviceId, method) {
  await Promise.all([
    Visitor.updateOne({ _id: visitorId }, { $set: { linkedAndroidDeviceId: deviceId } }),
    AndroidDevice.updateOne({ _id: deviceId }, { $set: { linkedVisitorId: visitorId } }),
  ]);
  console.log(`[User-Link:${method}] Visitor ${visitorId} ↔ AndroidDevice ${deviceId}`);
}

// ── STRONG SIGNALS — safe to link alone ──────────────────────

// 1. WebView localStorage token — same browser session, zero ambiguity
async function tryLinkByToken(webVisitorToken, deviceId) {
  if (!webVisitorToken || !deviceId) return;
  try {
    const visitor = await Visitor.findOne({ visitorToken: webVisitorToken })
      .select('_id linkedAndroidDeviceId').lean();
    if (!visitor) return;
    if (visitor.linkedAndroidDeviceId && String(visitor.linkedAndroidDeviceId) !== String(deviceId)) return;
    const device = await AndroidDevice.findById(deviceId).select('_id linkedVisitorId').lean();
    if (!device) return;
    if (device.linkedVisitorId && String(device.linkedVisitorId) !== String(visitor._id)) return;
    await _saveLink(visitor._id, deviceId, 'webview-token');
  } catch (e) {
    console.error('[User-Link:token]', e.message);
  }
}

// 2. Registered phone number — globally unique, safe alone
async function tryLinkByPhone(phone, sourceType, sourceId) {
  const cleaned = (phone || '').replace(/\D/g, '');
  if (cleaned.length < 7) return;
  try {
    if (sourceType === 'android') {
      const visitor = await Visitor.findOne({
        registeredPhone: { $regex: cleaned.slice(-7) },
        linkedAndroidDeviceId: null,
      }).select('_id').lean();
      if (!visitor) return;
      const device = await AndroidDevice.findById(sourceId).select('_id linkedVisitorId').lean();
      if (!device || device.linkedVisitorId) return;
      await _saveLink(visitor._id, sourceId, 'phone');
    } else {
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

// ── WEAK SIGNALS — require 2+ to agree before linking ────────
//
// Why "weak":
//   IP alone       → shared WiFi (family members, coworkers)
//   Fingerprint    → same phone model (Redmi Note 10, Samsung A12 etc.)
//   Location alone → two people near each other (market, temple, office)
//
// Rule: a candidate must score ≥ 2 out of 3 weak signals.
// If multiple candidates reach that threshold, we don't link (ambiguous).

async function tryLinkByWeakSignals(sourceId, sourceType) {
  try {
    let source, otherModel, otherLinkedField;

    if (sourceType === 'android') {
      source = await AndroidDevice.findById(sourceId)
        .select('_id ipAddresses screenWidth screenHeight language timezone latitude longitude locationUpdatedAt linkedVisitorId')
        .lean();
      if (!source || source.linkedVisitorId) return;
      otherModel = Visitor;
      otherLinkedField = 'linkedAndroidDeviceId';
    } else {
      source = await Visitor.findById(sourceId)
        .select('_id ipAddresses screenWidth screenHeight language timezone latitude longitude locationUpdatedAt linkedAndroidDeviceId')
        .lean();
      if (!source || source.linkedAndroidDeviceId) return;
      otherModel = AndroidDevice;
      otherLinkedField = 'linkedVisitorId';
    }

    // Gather all candidate IDs from each weak signal, then score by overlap

    // Signal A — shared IP
    const validIps = (source.ipAddresses || []).filter(
      ip => ip && !_SKIP_IPS.has(ip) && !ip.startsWith('::ffff:127') &&
            !ip.startsWith('192.168.') && !ip.startsWith('10.')
    );
    const ipMatches = new Set();
    if (validIps.length) {
      const rows = await otherModel
        .find({ ipAddresses: { $in: validIps }, [otherLinkedField]: null })
        .select('_id').lean();
      rows.forEach(r => ipMatches.add(String(r._id)));
    }

    // Signal B — device fingerprint (all 4 must match)
    const fpMatches = new Set();
    if (source.screenWidth && source.screenHeight && source.language && source.timezone) {
      const rows = await otherModel
        .find({
          screenWidth: source.screenWidth,
          screenHeight: source.screenHeight,
          language: source.language,
          timezone: source.timezone,
          [otherLinkedField]: null,
        })
        .select('_id').lean();
      rows.forEach(r => fpMatches.add(String(r._id)));
    }

    // Signal C — GPS within 100m and within 15 minutes
    const locMatches = new Set();
    if (source.latitude && source.longitude && source.locationUpdatedAt) {
      const windowMs = 15 * 60 * 1000;
      const since = new Date(source.locationUpdatedAt.getTime() - windowMs);
      const until = new Date(source.locationUpdatedAt.getTime() + windowMs);
      const latD = 0.001, lonD = 0.001;
      const rows = await otherModel
        .find({
          latitude:  { $gte: source.latitude  - latD, $lte: source.latitude  + latD },
          longitude: { $gte: source.longitude - lonD, $lte: source.longitude + lonD },
          locationUpdatedAt: { $gte: since, $lte: until },
          [otherLinkedField]: null,
        })
        .select('_id latitude longitude').lean();
      rows.forEach(r => {
        if (_haversineMeters(source.latitude, source.longitude, r.latitude, r.longitude) <= 100) {
          locMatches.add(String(r._id));
        }
      });
    }

    // Score each candidate — must appear in at least 2 of the 3 signal sets
    const allCandidates = new Set([...ipMatches, ...fpMatches, ...locMatches]);
    const qualified = [];
    for (const id of allCandidates) {
      const score = (ipMatches.has(id) ? 1 : 0) +
                    (fpMatches.has(id) ? 1 : 0) +
                    (locMatches.has(id) ? 1 : 0);
      if (score >= 2) qualified.push({ id, score });
    }

    // Only link if exactly one candidate qualifies — if multiple qualify it's ambiguous
    if (qualified.length !== 1) return;

    const winnerId = qualified[0].id;
    const signals = [
      ipMatches.has(winnerId) ? 'ip' : null,
      fpMatches.has(winnerId) ? 'fingerprint' : null,
      locMatches.has(winnerId) ? 'location' : null,
    ].filter(Boolean).join('+');

    if (sourceType === 'android') {
      await _saveLink(winnerId, sourceId, signals);
    } else {
      await _saveLink(sourceId, winnerId, signals);
    }
  } catch (e) {
    console.error('[User-Link:weak]', e.message);
  }
}

function _haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { tryLinkByToken, tryLinkByPhone, tryLinkByWeakSignals };
