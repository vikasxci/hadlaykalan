const mongoose = require('mongoose');

const workerUserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, unique: true, trim: true },
  whatsapp: { type: String, trim: true },
  village: { type: String, trim: true },
  userType: { 
    type: String, 
    required: true, 
    enum: ['worker', 'employer'],
    default: 'employer'
  },
  photo: { type: String, trim: true }, // Cloudinary URL
  areaLocation: { type: String, trim: true },
  verificationCode: { type: String },
  codeExpiresAt: { type: Date },
  isVerified: { type: Boolean, default: false },
  token: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('WorkerUser', workerUserSchema);
