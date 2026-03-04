const mongoose = require('mongoose');

const areaLocationSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  nameHi: { type: String, trim: true }, // Hindi name
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('AreaLocation', areaLocationSchema);
