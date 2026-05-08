const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  visitorToken: { type: String, required: true },
  visitorName: { type: String, required: true, trim: true },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  likes: { type: Number, default: 0 },
  likedTokens: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const postSchema = new mongoose.Schema({
  // Author — auto-filled from visitorToken/visitorName
  name: { type: String, required: true, trim: true },
  visitorToken: { type: String }, // token of the post author
  title: { type: String, required: true, trim: true },
  content: { type: String, required: true },
  topic: {
    type: String,
    enum: ['issue', 'good_work', 'message', 'announcement', 'feedback', 'thanks', 'other'],
    default: 'message'
  },
  profilePic: { type: String }, // Cloudinary URL
  profilePicCloudinaryId: { type: String },
  postImage: { type: String }, // Post photo / image URL
  postImageCloudinaryId: { type: String },
  editToken: { type: String }, // Token for user to edit their own post
  likes: { type: Number, default: 0 },
  likedTokens: [{ type: String }], // Track visitor tokens that liked
  likedIPs: [{ type: String }], // Track IPs that liked
  comments: [commentSchema],
  isApproved: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

postSchema.set('toJSON', { virtuals: true });
postSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.Post || mongoose.model('Post', postSchema);
