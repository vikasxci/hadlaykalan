const mongoose = require('mongoose');

const liveLocationShareSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracyMeters: { type: Number, default: null },
  sharedAt: { type: Date, default: Date.now, index: true },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  consentVersion: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('LiveLocationShare', liveLocationShareSchema);
