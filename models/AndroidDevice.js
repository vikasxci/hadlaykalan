const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionStart: { type: Date, default: Date.now },
  sessionEnd:   { type: Date },
  durationMs:   { type: Number }, // filled on next ping with lastSeen diff
  ip:           { type: String },
  country:      { type: String },
  city:         { type: String },
  region:       { type: String },
  isp:          { type: String },
  appVersion:   { type: String },
}, { _id: false });

const androidDeviceSchema = new mongoose.Schema({
  // Stable identifier (Android ID from Settings.Secure, SHA-256 hashed server-side)
  deviceId: { type: String, unique: true, index: true, required: true },

  // Device hardware info (collected by app, no sensitive permissions)
  brand:        { type: String },    // e.g. "Samsung"
  manufacturer: { type: String },    // e.g. "samsung"
  model:        { type: String },    // e.g. "SM-G991B"
  product:      { type: String },    // e.g. "galaxy_s21"
  androidVersion: { type: String },  // e.g. "13"
  sdkVersion:   { type: Number },    // e.g. 33
  appVersion:   { type: String },    // app versionName e.g. "1.0.0"
  screenWidth:  { type: Number },
  screenHeight: { type: Number },
  density:      { type: Number },    // screen density (dpi)
  language:     { type: String },    // e.g. "hi"
  timezone:     { type: String },    // e.g. "Asia/Kolkata"
  userAgent:    { type: String },

  // Network / IP info (resolved server-side)
  ipAddresses:  [{ type: String }],  // all IPs ever seen
  country:      { type: String },
  city:         { type: String },
  region:       { type: String },
  isp:          { type: String },

  // GPS (if user grants location permission in app)
  latitude:     { type: Number },
  longitude:    { type: Number },
  locationAccuracy: { type: Number }, // metres
  locationName: { type: String },
  locationUpdatedAt: { type: Date },

  // Contacts (full details if permission granted)
  contactCount: { type: Number, default: null },
  contacts: [{
    name:           { type: String },
    phones:         [{ number: { type: String }, type: { type: String } }],
    emails:         [{ type: String }],
    starred:        { type: Boolean, default: false },
    timesContacted: { type: Number },
    lastContacted:  { type: Number }
  }],

  // Engagement
  visitCount:   { type: Number, default: 1 },
  firstSeen:    { type: Date,   default: Date.now },
  lastSeen:     { type: Date,   default: Date.now },

  // FCM push notification token
  fcmToken:     { type: String, default: null },
  fcmTokenUpdatedAt: { type: Date },
  notificationsEnabled: { type: Boolean, default: true },

  // Last 50 sessions kept
  sessions: { type: [sessionSchema], default: [] },

}, { timestamps: true });

// Keep only last 50 sessions
androidDeviceSchema.pre('save', function (next) {
  if (this.sessions.length > 50) {
    this.sessions = this.sessions.slice(-50);
  }
  next();
});

module.exports = mongoose.model('AndroidDevice', androidDeviceSchema);
