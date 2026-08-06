const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  key:   { type: String },
  label: { type: String },
  value: { type: String }
}, { _id: false });

const popupResponseSchema = new mongoose.Schema({
  popup: { type: mongoose.Schema.Types.ObjectId, ref: 'PopupMessage', required: true, index: true },

  // Identity — web users carry a visitorToken, app users a deviceId
  visitorToken:  { type: String, index: true },
  visitor:       { type: mongoose.Schema.Types.ObjectId, ref: 'Visitor', default: null },
  deviceId:      { type: String, index: true },
  androidDevice: { type: mongoose.Schema.Types.ObjectId, ref: 'AndroidDevice', default: null },
  platform:      { type: String, enum: ['web', 'app'], default: 'web' },

  // 'submitted'    — filled the form
  // 'acknowledged' — pressed OK on an info-only popup
  // 'dismissed'    — closed a closable popup without answering
  action: { type: String, enum: ['submitted', 'acknowledged', 'dismissed'], default: 'submitted' },

  // Denormalised for the admin list / CSV export
  name:  { type: String, default: '' },
  phone: { type: String, default: '' },
  answers: { type: [answerSchema], default: [] },

  ip:        { type: String },
  userAgent: { type: String },
  page:      { type: String }
}, { timestamps: true });

// One row per user per popup — resubmits update in place
popupResponseSchema.index({ popup: 1, visitorToken: 1 });
popupResponseSchema.index({ popup: 1, deviceId: 1 });

module.exports = mongoose.models.PopupResponse || mongoose.model('PopupResponse', popupResponseSchema);
