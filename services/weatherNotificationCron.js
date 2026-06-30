/**
 * services/weatherNotificationCron.js
 *
 * Scheduled push notifications:
 *  - 7:00 AM IST  → morning weather summary
 *  - 6:00 PM IST  → evening weather update
 *
 * Uses node-cron (IST = UTC+5:30 → UTC times: 01:30 and 12:30)
 * Uses free Open-Meteo API (no key needed).
 */

const cron = require('node-cron');
const AndroidDevice = require('../models/AndroidDevice');

// Lazy-load FCM helper to avoid circular dependency
function getFcmHelper() {
  return require('../routes/androidDevices');
}

// Hadlay Kalan coords (can be overridden via env)
const LAT = process.env.WEATHER_LAT || '23.63';
const LON = process.env.WEATHER_LON || '76.72';

const WMO_CODES = {
  0: 'साफ आसमान ☀️',
  1: 'लगभग साफ 🌤️',
  2: 'आंशिक बादल ⛅',
  3: 'बादल 🌥️',
  45: 'कोहरा 🌫️', 48: 'कोहरा 🌫️',
  51: 'हल्की बूँदाबाँदी 🌦️', 53: 'बूँदाबाँदी 🌦️', 55: 'तेज़ बूँदाबाँदी 🌦️',
  61: 'हल्की बारिश 🌧️', 63: 'बारिश 🌧️', 65: 'तेज़ बारिश 🌧️',
  71: 'हल्की बर्फ ❄️', 73: 'बर्फ ❄️', 75: 'तेज़ बर्फ ❄️',
  80: 'बौछारें 🌦️', 81: 'बौछारें 🌦️', 82: 'तेज़ बौछारें ⛈️',
  95: 'आँधी-तूफान ⛈️', 96: 'ओले पड़ सकते हैं ⛈️', 99: 'भारी ओले ⛈️',
};

async function fetchWeather() {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LON}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code` +
    `&timezone=Asia/Kolkata&forecast_days=1`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Weather API error');
  return res.json();
}

function buildMorningMessage(w) {
  const cur   = w.current;
  const daily = w.daily;
  const desc  = WMO_CODES[cur.weather_code] || 'मौसम की जानकारी';
  const max   = Math.round(daily.temperature_2m_max[0]);
  const min   = Math.round(daily.temperature_2m_min[0]);
  const rain  = daily.precipitation_sum[0];
  const wind  = Math.round(cur.wind_speed_10m);

  let body = `${desc} | अभी: ${Math.round(cur.temperature_2m)}°C · अधिकतम: ${max}°C · न्यूनतम: ${min}°C`;
  if (rain > 0) body += ` · बारिश: ${rain} mm`;
  if (wind > 20) body += ` · हवा: ${wind} km/h`;
  return { title: '🌅 सुप्रभात! आज का मौसम - हडलाय कलां', body };
}

function buildEveningMessage(w) {
  const cur   = w.current;
  const daily = w.daily;
  const desc  = WMO_CODES[cur.weather_code] || 'मौसम';
  const rain  = daily.precipitation_sum[0];
  const humidity = Math.round(cur.relative_humidity_2m);

  let body = `${desc} | अभी: ${Math.round(cur.temperature_2m)}°C · नमी: ${humidity}%`;
  if (rain > 0) body += ` · आज बारिश: ${rain} mm`;
  return { title: '🌆 शाम का मौसम - हडलाय कलां', body };
}

async function sendWeatherNotification(type) {
  try {
    const weather = await fetchWeather();
    const msg = type === 'morning' ? buildMorningMessage(weather) : buildEveningMessage(weather);

    const devices = await AndroidDevice.find(
      { fcmToken: { $exists: true, $ne: null } },
      'fcmToken'
    );
    const tokens = devices.map(d => d.fcmToken).filter(Boolean);
    if (!tokens.length) { console.log('[WeatherCron] No devices with FCM token'); return; }

    const helper = getFcmHelper();
    const sendFcm = helper.sendFcmMulticast;
    if (typeof sendFcm !== 'function') throw new Error('sendFcmMulticast not available from androidDevices router');
    const result = await sendFcm(tokens, msg.title, msg.body, { type: 'weather', time: type, clickUrl: '/weather' });
    console.log(`[WeatherCron] ${type} notification sent: ${result.success} ok, ${result.failure} failed`);
  } catch (err) {
    console.error(`[WeatherCron] ${type} error:`, err.message);
  }
}

function startWeatherCron() {
  const fs   = require('fs');
  const path = require('path');
  const saPath = path.join(__dirname, '../firebase-service-account.json');
  const hasSA  = fs.existsSync(saPath) || !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!hasSA) {
    console.warn('[WeatherCron] firebase-service-account.json not found — weather notifications disabled');
    console.warn('[WeatherCron] Place the file in Admin/ folder to enable. See Firebase Console → Project Settings → Service Accounts');
    return;
  }

  // 7:00 AM IST = 01:30 UTC  → cron: '30 1 * * *'
  cron.schedule('30 1 * * *', () => sendWeatherNotification('morning'), { timezone: 'UTC' });

  // 6:00 PM IST = 12:30 UTC  → cron: '30 12 * * *'
  cron.schedule('30 12 * * *', () => sendWeatherNotification('evening'), { timezone: 'UTC' });

  console.log('[WeatherCron] Scheduled: 7:00 AM IST (morning) and 6:00 PM IST (evening)');
}

module.exports = { startWeatherCron, sendWeatherNotification };
