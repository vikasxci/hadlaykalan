const mongoose = require('mongoose');
const { Schema } = mongoose;

const inventorySupplierSchema = new Schema({
  business:     { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },

  // Identity
  name:        { type: String, required: true, trim: true },
  companyName: { type: String, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  phone:       { type: String, required: true, trim: true },
  altPhone:    { type: String, trim: true },

  // Address
  address: {
    street:  { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, default: 'India' }
  },

  // Legal
  gstin: { type: String, trim: true },
  pan:   { type: String, trim: true },

  // Financial Terms
  creditLimitDays:   { type: Number, default: 0 },   // Payment due in X days
  creditLimitAmount: { type: Number, default: 0 },   // Max credit amount
  openingBalance:    { type: Number, default: 0 },   // Amount owed at start
  currentBalance:    { type: Number, default: 0 },   // Positive = we owe them

  // Performance (ML features)
  totalOrders:        { type: Number, default: 0 },
  totalPurchaseValue: { type: Number, default: 0 },
  avgLeadTimeDays:    { type: Number, default: 0 },
  reliabilityScore:   { type: Number, min: 0, max: 5, default: 0 }, // 0-5 rating
  returnRate:         { type: Number, default: 0 },   // % of items returned

  // Meta
  notes:    { type: String, trim: true },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

inventorySupplierSchema.index({ business: 1, name: 1 });

module.exports = mongoose.model('InventorySupplier', inventorySupplierSchema);
