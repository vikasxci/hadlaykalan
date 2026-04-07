const mongoose = require('mongoose');

const shopProductSchema = new mongoose.Schema({
  seller:      { type: mongoose.Schema.Types.ObjectId, ref: 'ShopSeller', required: true },
  title:       { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price:       { type: Number, required: true, min: 0 },
  mrp:         { type: Number, min: 0 },          // original / MRP for discount badge
  unit:        { type: String, trim: true },       // e.g. "per kg", "per piece"
  category:    {
    type: String,
    required: true,
    enum: ['grocery', 'vegetables', 'fruits', 'dairy', 'clothing', 'electronics', 'medicines', 'hardware', 'stationery', 'other'],
    default: 'other'
  },
  images:      [{ type: String }],                 // Cloudinary URLs
  stock:       { type: Number, default: 0, min: 0 },
  isActive:    { type: Boolean, default: true },

  // Analytics
  totalClicks: { type: Number, default: 0 },
  totalViews:  { type: Number, default: 0 },
  clicks: [{
    clickedAt:  { type: Date, default: Date.now },
    userAgent:  { type: String },
    page:       { type: String }                   // which page the ad was shown on
  }]
}, { timestamps: true });

// Index for fast random ad queries
shopProductSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('ShopProduct', shopProductSchema);
