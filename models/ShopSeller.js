const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const shopSellerSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  phone:       { type: String, required: true, unique: true, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  shopName:    { type: String, required: true, trim: true },
  shopDesc:    { type: String, trim: true },
  address:     { type: String, trim: true },
  category:    { type: String, trim: true },
  photo:       { type: String },           // Cloudinary URL
  password:    { type: String, required: true },
  token:       { type: String },
  isActive:    { type: Boolean, default: true },
  // Real-time WebSocket connection tracking (runtime only)
  wsConnected: { type: Boolean, default: false }
}, { timestamps: true });

shopSellerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

shopSellerSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

module.exports = mongoose.model('ShopSeller', shopSellerSchema);
