const mongoose = require('mongoose');

const marketPostSchema = new mongoose.Schema({
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser', required: true },

  // sell = posting item for sale | buy = looking to purchase
  postType: {
    type: String,
    required: true,
    enum: ['sell', 'buy'],
    default: 'sell'
  },

  category: {
    type: String,
    required: true,
    enum: ['animals', 'crops', 'land', 'vehicle', 'equipment', 'seeds', 'household', 'other']
  },

  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },

  price: { type: Number, min: 0 },
  priceType: { type: String, enum: ['fixed', 'negotiable', 'free'], default: 'negotiable' },
  quantity: { type: String, trim: true },

  images: [{ type: String }],  // Cloudinary URLs
  location: { type: String, trim: true },

  status: { type: String, default: 'active', enum: ['active', 'sold', 'closed'] },

  // Users who expressed interest (both sides share numbers)
  interestedBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser' },
    at: { type: Date, default: Date.now }
  }],

  isApproved: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('MarketPost', marketPostSchema);
