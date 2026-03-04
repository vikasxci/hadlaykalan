const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  content: { type: String, required: true },
  profilePic: { type: String }, // Cloudinary URL
  profilePicCloudinaryId: { type: String },
  likes: { type: Number, default: 0 },
  likedIPs: [{ type: String }], // Track IPs that liked
  isApproved: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

postSchema.set('toJSON', { virtuals: true });
postSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Post', postSchema);
