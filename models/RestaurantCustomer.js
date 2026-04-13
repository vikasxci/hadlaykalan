const mongoose = require('mongoose');
const { Schema } = mongoose;

const restaurantCustomerSchema = new Schema({
  restaurant:   { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },

  // Identity
  name:         { type: String, required: true, trim: true },
  phone:        { type: String, required: true, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  birthdate:    { type: Date },
  anniversary:  { type: Date },
  avatar:       { type: String },

  // Address
  address:      { type: String, trim: true },
  city:         { type: String, trim: true },

  // Tags & groups
  group:        { type: String, enum: ['regular', 'vip', 'corporate', 'online'], default: 'regular' },
  tags:         [{ type: String, trim: true }],

  // Dining stats
  totalOrders:   { type: Number, default: 0 },
  totalSpent:    { type: Number, default: 0 },
  avgOrderValue: { type: Number, default: 0 },
  lastVisitAt:   { type: Date },
  firstVisitAt:  { type: Date },

  // Loyalty
  loyaltyPoints:       { type: Number, default: 0 },
  lifetimeLoyalty:     { type: Number, default: 0 },  // total pts ever earned
  loyaltyRedeemed:     { type: Number, default: 0 },

  // Notes
  dietaryPrefs:  { type: String, trim: true },   // veg only, allergies, etc.
  notes:         { type: String, trim: true },

  // Delivery
  deliveryAddresses: [{
    label:    { type: String, default: 'Home' },
    address:  { type: String },
    pincode:  { type: String },
    isDefault: { type: Boolean, default: false }
  }],

  isActive:  { type: Boolean, default: true }

}, { timestamps: true });

restaurantCustomerSchema.index({ restaurant: 1, phone: 1 }, { unique: true });
restaurantCustomerSchema.index({ restaurant: 1, name: 'text' });

module.exports = mongoose.model('RestaurantCustomer', restaurantCustomerSchema);
