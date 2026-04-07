const https = require('https');
const http  = require('http');
const Monitor = require('../models/Monitor');

const MAX_HISTORY = 90; // keep last 90 pings

/**
 * Ping a single monitor by ID.
 * Updates the Monitor document in place.
 * Returns the updated monitor doc.
 */
async function pingMonitor(monitorId) {
  const monitor = await Monitor.findById(monitorId);
  if (!monitor || !monitor.isActive) return null;

  const start = Date.now();
  let status = 'down';
  let responseTime = null;

  try {
    await new Promise((resolve, reject) => {
      let url;
      try { url = new URL(monitor.url); } catch { return reject(new Error('Invalid URL')); }

      const requestLib = url.protocol === 'https:' ? https : http;

      function doRequest(method) {
        const options = {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method,
          timeout: 10000,
          headers: { 'User-Agent': 'UptimeMonitor/1.0' }
        };

        const req = requestLib.request(options, (res) => {
          res.resume(); // discard body
          // If HEAD returned 4xx/5xx, retry with GET (some servers reject HEAD)
          if (method === 'HEAD' && res.statusCode >= 400) {
            return doRequest('GET');
          }
          responseTime = Date.now() - start;
          status = res.statusCode < 400 ? 'up' : 'down';
          resolve();
        });

        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', (err) => {
          // If HEAD errored out, retry with GET
          if (method === 'HEAD') return doRequest('GET');
          reject(err);
        });
        req.end();
      }

      doRequest('HEAD');
    });
  } catch {
    responseTime = null;
    status = 'down';
  }

  // Append to history, keep last MAX_HISTORY
  const ping = { status, responseTime, checkedAt: new Date() };
  monitor.history.push(ping);
  if (monitor.history.length > MAX_HISTORY) {
    monitor.history = monitor.history.slice(-MAX_HISTORY);
  }

  // Calculate uptime % from history
  const upCount = monitor.history.filter(h => h.status === 'up').length;
  const uptime = monitor.history.length > 0
    ? Math.round((upCount / monitor.history.length) * 100 * 100) / 100
    : 100;

  monitor.status = status;
  monitor.responseTime = responseTime;
  monitor.lastChecked = new Date();
  monitor.uptime = uptime;

  await monitor.save();
  return monitor;
}

/**
 * Run a full round of pings for all active monitors.
 */
async function runAllPings() {
  try {
    const monitors = await Monitor.find({ isActive: true }).select('_id');
    await Promise.allSettled(monitors.map(m => pingMonitor(m._id)));
  } catch (err) {
    console.error('[UptimeMonitor] runAllPings error:', err.message);
  }
}

/**
 * Start the scheduler.
 * Each monitor has its own interval (in minutes).
 * We run a master tick every minute and check which monitors are due.
 */
function startMonitorScheduler() {
  console.log('[UptimeMonitor] Scheduler started');

  const TICK_MS = 60 * 1000; // 1 minute tick

  // Track last-run time per monitor ID
  const lastRun = {};

  setInterval(async () => {
    try {
      const monitors = await Monitor.find({ isActive: true }).select('_id interval');
      const now = Date.now();

      await Promise.allSettled(monitors.map(async (m) => {
        const intervalMs = (m.interval || 300) * 1000; // interval stored in seconds
        const last = lastRun[m._id.toString()] || 0;
        if (now - last >= intervalMs) {
          lastRun[m._id.toString()] = now;
          await pingMonitor(m._id);
        }
      }));
    } catch (err) {
      console.error('[UptimeMonitor] tick error:', err.message);
    }
  }, TICK_MS);

  // Run all immediately on start
  runAllPings();
}

module.exports = { pingMonitor, runAllPings, startMonitorScheduler };
