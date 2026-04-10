const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const inventoryBusinessSchema = new mongoose.Schema({
  // Owner Identity
  ownerName:     { type: String, required: true, trim: true },
  businessName:  { type: String, required: true, trim: true },
  slug:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:         { type: String, required: true, trim: true },
  password:      { type: String, required: true },

  // Business Classification
  businessType: {
    type: String,
    enum: ['retail', 'wholesale', 'manufacturing', 'service', 'restaurant', 'pharmacy',
           'hardware', 'grocery', 'clothing', 'electronics', 'agriculture', 'other'],
    default: 'retail'
  },
  description:   { type: String, trim: true },
  logo:          { type: String },   // Cloudinary URL
  website:       { type: String, trim: true },

  // Address
  address: {
    street:  { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, default: 'India' }
  },

  // Legal / Tax
  gstin:     { type: String, trim: true },
  pan:       { type: String, trim: true },
  licenseNo: { type: String, trim: true },

  // App Settings
  currency:           { type: String, default: 'INR' },
  currencySymbol:     { type: String, default: '₹' },
  timezone:           { type: String, default: 'Asia/Kolkata' },
  language:           { type: String, default: 'en' },
  lowStockThreshold:  { type: Number, default: 5 },
  fiscalYearStart:    { type: String, default: 'April' }, // Month name

  // Tax defaults
  defaultTaxType: { type: String, enum: ['none', 'gst', 'igst', 'vat', 'other'], default: 'gst' },
  defaultTaxRate: { type: Number, default: 18 },

  // Session
  token:         { type: String },
  isActive:      { type: Boolean, default: true },
  isVerified:    { type: Boolean, default: false },

  // ML / Analytics metadata
  registrationSource: { type: String, trim: true },  // web, mobile, referral
  lastLoginAt:        { type: Date },
  loginCount:         { type: Number, default: 0 },
  deviceInfo:         { type: String }

}, { timestamps: true });

inventoryBusinessSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

inventoryBusinessSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

// Auto-generate slug from businessName if not provided
inventoryBusinessSchema.pre('validate', function (next) {
  if (!this.slug && this.businessName) {
    this.slug = this.businessName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }
  next();
});

module.exports = mongoose.model('InventoryBusiness', inventoryBusinessSchema);
