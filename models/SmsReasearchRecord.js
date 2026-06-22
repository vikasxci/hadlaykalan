const mongoose = require('mongoose');

const smsResearchRecordSchema = new mongoose.Schema({
  deviceId:   { type: String, required: true, index: true },
  sender:     { type: String, required: true, maxlength: 80 },
  body:       { type: String, required: true, maxlength: 500 },
  receivedAt: { type: Date, required: true },
  uploadedAt: { type: Date, default: Date.now },
  expiresAt:  { type: Date, required: true, index: { expires: 0 } },
  consentVersion: { type: String, default: 'sms-single-v1' },
}, { versionKey: false });

module.exports = mongoose.model('SmsResearchRecord', smsResearchRecordSchema);
