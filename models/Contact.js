const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  role: { type: String, enum: ['sarpanch', 'mantri', 'doctor', 'teacher', 'shopkeeper', 'farmer', 'electrician', 'plumber', 'student', 'dairy', 'aspirant', 'ngo_worker', 'healthcare_worker', 'govt_official', 'priest', 'business_owner', 'other'], default: 'other' },
  address: { type: String },
  image: { type: String },
  cloudinaryId: { type: String },
  isApproved: { type: Boolean, default: false },
  isImportant: { type: Boolean, default: false },
  description: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Contact', contactSchema);
