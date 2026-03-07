const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
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
  likedIPs: [{ type: String }], // Track IPs that liked
  isApproved: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

postSchema.set('toJSON', { virtuals: true });
postSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Post', postSchema);
