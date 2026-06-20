const mongoose = require('mongoose');

const locationHistorySchema = new mongoose.Schema({
  entityType: { type: String, enum: ['Visitor', 'AndroidDevice'], required: true },
  entityId:   { type: mongoose.Schema.Types.ObjectId, required: true },
  latitude:       { type: Number, required: true },
  longitude:      { type: Number, required: true },
  locationName:   { type: String },
  city:           { type: String },
  region:         { type: String },
  country:        { type: String },
  accuracyMeters: { type: Number },
  recordedAt:     { type: Date, default: Date.now },
});

locationHistorySchema.index({ entityType: 1, entityId: 1, recordedAt: -1 });

module.exports = mongoose.model('LocationHistory', locationHistorySchema);
