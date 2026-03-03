const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { type: String, enum: ['event', 'meeting', 'announcement', 'emergency', 'general'], default: 'general' },
  date: { type: Date, default: Date.now },
  eventDate: { type: Date },
  postedBy: { type: String, default: 'Sarpanch' },
  image: { type: String },
  cloudinaryId: { type: String },
  isActive: { type: Boolean, default: true },
  isPinned: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Notice', noticeSchema);
