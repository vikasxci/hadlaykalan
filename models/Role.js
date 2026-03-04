const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true }, // e.g. 'doctor'
  label: { type: String, required: true, trim: true }, // English display label e.g. 'Doctor'
  labelHi: { type: String, trim: true }, // Hindi display label e.g. 'डॉक्टर'
  icon: { type: String, default: 'fa-user' }, // FontAwesome icon class
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema);
