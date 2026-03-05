const mongoose = require('mongoose');

const visitorSchema = new mongoose.Schema({
  ip: { type: String, required: true, index: true },
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
  pages: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('Visitor', visitorSchema);
