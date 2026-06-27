const mongoose = require('mongoose');

const userLocationSchema = new mongoose.Schema({
  // Source of the location record
  source: { type: String, enum: ['web', 'android'], required: true },

  // Optional links to known users
  visitorId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor',       default: null },
  androidDeviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'AndroidDevice', default: null },

  // Display name resolved at record time
  displayName: { type: String, default: null }, // e.g. "Shyam Panwar" or "Samsung Galaxy"

  // Coordinates
  latitude:  { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy:  { type: Number, default: null }, // metres

  // Reverse-geocoded or IP-based location text
  city:    { type: String, default: '' },
  region:  { type: String, default: '' },
  country: { type: String, default: '' },
  locationName: { type: String, default: '' }, // human-readable label

  // Request metadata
  ip:        { type: String, default: '' },
  userAgent: { type: String, default: '' },

  recordedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// Auto-expire records after 90 days
userLocationSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

// Geo-index for distance queries
userLocationSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('UserLocation', userLocationSchema);
