const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  ipAddresses: [{ type: String }], // Array of IPs from different visits with same token
  visitorToken: { type: String, unique: true, sparse: true, index: true }, // Persistent token for tracking
  visitorName: { type: String }, // Auto-generated name like user1, user2
  userAgent: { type: String },
  browser: { type: String },
  browserVersion: { type: String },
  os: { type: String },
  osVersion: { type: String },
  device: { type: String }, // mobile, tablet, desktop
  screenWidth: { type: Number },
  screenHeight: { type: Number },
  language: { type: String },
  timezone: { type: String },
  referrer: { type: String },
  platform: { type: String },
  country: { type: String },
  city: { type: String },
  region: { type: String },
  isp: { type: String },
  visitCount: { type: Number, default: 1 },
  lastVisit: { type: Date, default: Date.now },
  firstVisit: { type: Date, default: Date.now },
  pages: [{ type: String }],
  // Registration fields (filled after 5+ visits)
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

module.exports = mongoose.model('Visitor', visitorSchema);
