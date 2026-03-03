const mongoose = require('mongoose');

const sliderSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  image: { type: String, required: true },
  cloudinaryId: { type: String },
  link: { type: String },
  type: { type: String, enum: ['news', 'ad', 'event'], default: 'news' },
  isActive: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Slider', sliderSchema);
