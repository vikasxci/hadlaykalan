const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  type: { type: String, enum: ['page_view', 'click', 'page_switch', 'session_start', 'session_end', 'search', 'scroll', 'form_submit', 'external_link', 'other'], default: 'other' },
  page: { type: String },         // current page path / hash
  fromPage: { type: String },      // previous page (for page_switch)
  element: { type: String },       // tag + id/class of clicked element
  elementText: { type: String },   // button/link text (truncated)
  elementId: { type: String },
  elementClass: { type: String },
  value: { type: String },         // extra data (search term, etc.)
  timeOnPage: { type: Number },    // ms spent on previous page
  ts: { type: Date, default: Date.now }
}, { _id: false });

const visitorSchema = new mongoose.Schema({
  ipAddresses: [{ type: String }],
  visitorToken: { type: String, unique: true, sparse: true, index: true },
  visitorName: { type: String },
  userAgent: { type: String },
  browser: { type: String },
  browserVersion: { type: String },
  os: { type: String },
  osVersion: { type: String },
  device: { type: String },
  screenWidth: { type: Number },
  screenHeight: { type: Number },
  language: { type: String },
  timezone: { type: String },
  referrer: { type: String },
  platform: { type: String },
  colorDepth: { type: Number },
  connectionType: { type: String },
  country: { type: String },
  city: { type: String },
  region: { type: String },
  isp: { type: String },
  // GPS location (requires browser permission)
  latitude: { type: Number },
  longitude: { type: Number },
  locationName: { type: String },   // reverse-geocoded name
  locationAccuracy: { type: Number },
  locationUpdatedAt: { type: Date },
  locationDenied: { type: Boolean, default: false },
  visitCount: { type: Number, default: 1 },
  totalTimeOnSite: { type: Number, default: 0 }, // ms
  lastVisit: { type: Date, default: Date.now },
  firstVisit: { type: Date, default: Date.now },
  // Streak fields
  currentStreak: { type: Number, default: 1 },
  longestStreak: { type: Number, default: 1 },
  lastStreakDate: { type: String, default: null }, // 'YYYY-MM-DD'
  pages: [{ type: String }],
  activityLog: { type: [activitySchema], default: [] },
  // Registration fields
  isRegistered: { type: Boolean, default: false },
  registeredName: { type: String },
  registeredPhone: { type: String },
  registeredPhoto: { type: String },
  registeredPhotoCloudinaryId: { type: String },
  registeredProfession: { type: String },
  registeredArea: { type: String },
  registeredAt: { type: Date },
  otpCode: { type: String },
  otpExpiry: { type: Date }
}, { timestamps: true });

module.exports = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
