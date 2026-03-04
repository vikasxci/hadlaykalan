const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, default: 'other', trim: true },
  areaLocation: { type: String, default: '', trim: true },
  address: { type: String },
  image: { type: String },
  cloudinaryId: { type: String },
  isApproved: { type: Boolean, default: false },
  isImportant: { type: Boolean, default: false },
  description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Contact', contactSchema);
