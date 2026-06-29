const mongoose = require('mongoose');

const userLocationSchema = new mongoose.Schema({
  // 'web' = browser visitor, 'android' = app user
  source: { type: String, enum: ['web', 'android'], required: true },

  // Visitor identity — same for both web and android app users
  visitorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor', default: null },
  displayName: { type: String, default: null },

  // Coordinates
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy:  { type: Number, default: null },

  // Human-readable location (reverse-geocoded)
  locationName: { type: String, default: '' },
  city:         { type: String, default: '' },
  region:       { type: String, default: '' },
  country:      { type: String, default: '' },

  recordedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// Auto-expire records after 90 days
userLocationSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

userLocationSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('UserLocation', userLocationSchema);
