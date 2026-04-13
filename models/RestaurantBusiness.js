const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { Schema } = mongoose;

const taxConfigSchema = new Schema({
  cgstPercent:     { type: Number, default: 2.5 },
  sgstPercent:     { type: Number, default: 2.5 },
  igstPercent:     { type: Number, default: 0 },
  cessPercent:     { type: Number, default: 0 },
  inclusiveTax:    { type: Boolean, default: true }  // prices include tax?
}, { _id: false });

const restaurantBusinessSchema = new Schema({
  // ── Identity ──────────────────────────────────────────────────────────────
  businessName:  { type: String, required: true, trim: true },
  slug:          { type: String, unique: true, sparse: true },
  ownerName:     { type: String, required: true, trim: true },
  email:         { type: String, required: true, lowercase: true, trim: true, unique: true },
  phone:         { type: String, required: true, trim: true, unique: true },
  password:      { type: String, required: true },
  logo:          { type: String },          // Cloudinary URL
  coverImage:    { type: String },

  // ── Business details ──────────────────────────────────────────────────────
  businessType: {
    type: String,
    enum: ['restaurant', 'cafe', 'bar', 'dhaba', 'cloud_kitchen', 'bakery', 'qsr', 'fine_dining'],
    default: 'restaurant'
  },
  cuisine:    [{ type: String, trim: true }],  // e.g. ['North Indian', 'Chinese']
  gstin:      { type: String, trim: true },
  fssaiNo:    { type: String, trim: true },
  address: {
    street:  { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    pincode: { type: String, trim: true }
  },

  // ── Business hours ────────────────────────────────────────────────────────
  hours: {
    type: Map,
    of: new Schema({
      open:  { type: String, default: '09:00' },
      close: { type: String, default: '22:00' },
      closed: { type: Boolean, default: false }
    }, { _id: false }),
    default: {}
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    currency:       { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    timezone:       { type: String, default: 'Asia/Kolkata' },
    taxConfig:      { type: taxConfigSchema, default: () => ({}) },
    serviceCharge: {
      enabled: { type: Boolean, default: false },
      percent: { type: Number, default: 5 }
    },
    roundOff:       { type: Boolean, default: true },
    tableRequired:  { type: Boolean, default: true },
    orderTypes:     { type: [String], default: ['dine-in', 'takeaway', 'delivery'] },
    paymentModes:   { type: [String], default: ['cash', 'upi', 'card'] },
    // Printing
    kotHeader:      { type: String, default: '' },   // custom text on KOT
    billHeader:     { type: String, default: '' },   // header on bill
    billFooter:     { type: String, default: 'Thank you! Visit again.' },
    billCopies:     { type: Number, default: 1 },
    // Stations
    kitchenStations: { type: [String], default: ['Main Kitchen'] }  // e.g. ['Grill', 'Fry', 'Dessert']
  },

  // ── Features ──────────────────────────────────────────────────────────────
  features: {
    reservations:  { type: Boolean, default: false },
    loyalty:       { type: Boolean, default: true },
    inventory:     { type: Boolean, default: true },   // recipe-based stock deduction
    delivery:      { type: Boolean, default: false },
    multiFloor:    { type: Boolean, default: false },
    kds:           { type: Boolean, default: true },   // kitchen display system
    qrMenu:        { type: Boolean, default: false }
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  token:       { type: String },
  isActive:    { type: Boolean, default: true },
  lastLoginAt: { type: Date },
  loginCount:  { type: Number, default: 0 }

}, { timestamps: true });

// Indexes
restaurantBusinessSchema.index({ email: 1 }, { unique: true });
restaurantBusinessSchema.index({ phone: 1 }, { unique: true });
restaurantBusinessSchema.index({ slug: 1 });

// Hash password on save
restaurantBusinessSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

restaurantBusinessSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

restaurantBusinessSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.token;
  return obj;
};

module.exports = mongoose.model('RestaurantBusiness', restaurantBusinessSchema);
