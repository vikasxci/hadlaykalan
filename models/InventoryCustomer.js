const mongoose = require('mongoose');
const { Schema } = mongoose;

const inventoryCustomerSchema = new Schema({
  business:       { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },
  name:           { type: String, required: true, trim: true },
  phone:          { type: String, trim: true },
  email:          { type: String, trim: true, lowercase: true },
  address: {
    street:  { type: String, trim: true },
    city:    { type: String, trim: true },
    state:   { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  gstin:          { type: String, trim: true },
  group:          { type: String, enum: ['retail', 'wholesale', 'vip', 'regular', 'other'], default: 'retail' },
  notes:          { type: String, trim: true },
  // Aggregated stats (updated on invoice create/update)
  totalInvoices:  { type: Number, default: 0 },
  totalAmount:    { type: Number, default: 0 },
  totalPaid:      { type: Number, default: 0 },
  outstandingDue: { type: Number, default: 0 },
  lastPurchaseAt: { type: Date },
  isActive:       { type: Boolean, default: true },

  // Restaurant-specific stats (updated when restaurant orders are billed)
  totalRestaurantOrders: { type: Number, default: 0 },
  totalRestaurantSpent:  { type: Number, default: 0 },
  lastDineAt:            { type: Date },
  avgRestaurantOrder:    { type: Number, default: 0 },
  restaurantNotes:       { type: String, trim: true },   // dietary preferences, allergies
  loyaltyPoints:         { type: Number, default: 0 },
}, { timestamps: true });

inventoryCustomerSchema.index({ business: 1, name: 1 });
inventoryCustomerSchema.index({ business: 1, phone: 1 });
inventoryCustomerSchema.index({ business: 1, isActive: 1 });

module.exports = mongoose.models.InventoryCustomer || mongoose.model('InventoryCustomer', inventoryCustomerSchema);
