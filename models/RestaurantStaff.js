const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { Schema } = mongoose;

const restaurantStaffSchema = new Schema({
  restaurant: { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },

  // ── Identity ──────────────────────────────────────────────────────────────
  name:    { type: String, required: true, trim: true },
  email:   { type: String, lowercase: true, trim: true },
  phone:   { type: String, trim: true },
  avatar:  { type: String },

  // ── Auth ──────────────────────────────────────────────────────────────────
  password:    { type: String },           // Full login (owner / manager / cashier)
  pin:         { type: String },           // 4-6 digit PIN (waiter / kitchen — quick login)
  role: {
    type: String,
    enum: ['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'delivery'],
    default: 'waiter',
    required: true
  },

  // ── Fine-grained permissions (override role defaults) ─────────────────────
  permissions: {
    // Menu
    viewMenu:       { type: Boolean, default: null },   // null = use role default
    editMenu:       { type: Boolean, default: null },
    // Orders
    createOrder:    { type: Boolean, default: null },
    editOrder:      { type: Boolean, default: null },   // modify items on open order
    cancelOrder:    { type: Boolean, default: null },
    applyDiscount:  { type: Boolean, default: null },
    // Billing
    billing:        { type: Boolean, default: null },
    voidBill:       { type: Boolean, default: null },
    // Reports
    viewReports:    { type: Boolean, default: null },
    // Staff
    manageStaff:    { type: Boolean, default: null },
    // Settings
    manageSettings: { type: Boolean, default: null }
  },

  // ── Work info ─────────────────────────────────────────────────────────────
  designation:  { type: String, trim: true },  // e.g. Head Waiter, Sous Chef
  salary:       { type: Number, default: 0 },
  joiningDate:  { type: Date },

  // ── Session ───────────────────────────────────────────────────────────────
  token:       { type: String },
  lastLoginAt: { type: Date },
  loginCount:  { type: Number, default: 0 },
  isActive:    { type: Boolean, default: true }

}, { timestamps: true });

// Indexes
restaurantStaffSchema.index({ restaurant: 1, role: 1 });
restaurantStaffSchema.index({ restaurant: 1, email: 1 }, { sparse: true });

// Hash password before save
restaurantStaffSchema.pre('save', async function (next) {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  if (this.isModified('pin') && this.pin) {
    this.pin = await bcrypt.hash(this.pin, 10);
  }
  next();
});

restaurantStaffSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

restaurantStaffSchema.methods.comparePin = function (plain) {
  return bcrypt.compare(plain, this.pin);
};

// Role-default permissions helper
restaurantStaffSchema.methods.can = function (action) {
  // Check explicit override first
  if (this.permissions[action] !== null && this.permissions[action] !== undefined) {
    return this.permissions[action];
  }
  // Role defaults
  const roleDefaults = {
    owner:    { viewMenu:true, editMenu:true, createOrder:true, editOrder:true, cancelOrder:true, applyDiscount:true, billing:true, voidBill:true, viewReports:true, manageStaff:true, manageSettings:true },
    manager:  { viewMenu:true, editMenu:true, createOrder:true, editOrder:true, cancelOrder:true, applyDiscount:true, billing:true, voidBill:true, viewReports:true, manageStaff:true, manageSettings:false },
    cashier:  { viewMenu:true, editMenu:false, createOrder:true, editOrder:false, cancelOrder:false, applyDiscount:true, billing:true, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    waiter:   { viewMenu:true, editMenu:false, createOrder:true, editOrder:true, cancelOrder:false, applyDiscount:false, billing:false, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    kitchen:  { viewMenu:true, editMenu:false, createOrder:false, editOrder:false, cancelOrder:false, applyDiscount:false, billing:false, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false },
    delivery: { viewMenu:false, editMenu:false, createOrder:false, editOrder:false, cancelOrder:false, applyDiscount:false, billing:false, voidBill:false, viewReports:false, manageStaff:false, manageSettings:false }
  };
  return (roleDefaults[this.role] || {})[action] || false;
};

restaurantStaffSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.pin;
  delete obj.token;
  return obj;
};

module.exports = mongoose.model('RestaurantStaff', restaurantStaffSchema);
