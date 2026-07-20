const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  visitorToken: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  profilePic: { type: String },

  mediaUrl: { type: String, required: true },
  mediaCloudinaryId: { type: String, required: true },
  caption: { type: String, trim: true, maxlength: 200 },

  viewCount: { type: Number, default: 0 },
  viewedTokens: [{ type: String }],

  likeCount: { type: Number, default: 0 },
  likedTokens: [{ type: String }],

  createdAt: { type: Date, default: Date.now },
  // TTL index — MongoDB's background sweep removes the document itself once
  // expiresAt passes. This is only a safety net for the DB side; the actual
  // Cloudinary asset deletion is done explicitly by storyExpiryCron.js,
  // since a TTL index cannot call external APIs.
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

storySchema.set('toJSON', { virtuals: true });
storySchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Story || mongoose.model('Story', storySchema);
