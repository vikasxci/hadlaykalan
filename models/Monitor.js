const mongoose = require('mongoose');

const pingSchema = new mongoose.Schema({
  status: { type: String, enum: ['up', 'down'], required: true },
  responseTime: { type: Number, default: null }, // ms
  checkedAt: { type: Date, default: Date.now }
}, { _id: false });

const monitorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  interval: { type: Number, default: 300, min: 10, max: 86400 }, // seconds
  status: { type: String, enum: ['up', 'down', 'pending'], default: 'pending' },
  responseTime: { type: Number, default: null }, // last response time in ms
  lastChecked: { type: Date, default: null },
  uptime: { type: Number, default: 100 }, // percentage 0-100
  isActive: { type: Boolean, default: true },
  description: { type: String, default: '' },
  // Last 90 pings for history bar (like UptimeRobot)
  history: { type: [pingSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Monitor', monitorSchema);
