const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderItemSchema = new Schema({
  menuItem:  { type: Schema.Types.ObjectId, ref: 'RestaurantMenuItem' },
  name:      { type: String, required: true },
  category:  { type: String },
  variant:   { type: String, default: '' },
  qty:       { type: Number, required: true, min: 1, default: 1 },
  price:     { type: Number, required: true, min: 0 },
  taxRate:   { type: Number, default: 0 },
  modifiers: [{ name: String, option: String, price: { type: Number, default: 0 } }],
  notes:     { type: String, trim: true },
  station:   { type: String, default: 'Main Kitchen' },
  status: {
    type: String,
    enum: ['pending', 'preparing', 'ready', 'served', 'cancelled'],
    default: 'pending'
  },
  sentAt:    { type: Date },
  readyAt:   { type: Date }
}, { _id: true });

const restaurantOrderSchema = new Schema({
  restaurant:           { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  orderNumber:          { type: String, required: true },
  type:                 { type: String, enum: ['dine-in', 'takeaway', 'delivery'], default: 'dine-in' },

  // Table info (dine-in)
  table:                { type: Schema.Types.ObjectId, ref: 'RestaurantTable' },
  tableNo:              { type: String },
  area:                 { type: String },

  // Customer / Delivery
  customer:             { type: Schema.Types.ObjectId, ref: 'RestaurantCustomer' },
  customerName:         { type: String, trim: true },
  customerPhone:        { type: String, trim: true },
  deliveryAddress:      { type: String, trim: true },

  waiter:               { type: Schema.Types.ObjectId, ref: 'RestaurantStaff' },
  waiterName:           { type: String, trim: true },
  cashier:              { type: Schema.Types.ObjectId, ref: 'RestaurantStaff' },
  persons:              { type: Number, default: 1 },

  items:                [orderItemSchema],

  // Order lifecycle
  status: {
    type: String,
    enum: ['open', 'preparing', 'ready', 'billed', 'cancelled'],
    default: 'open'
  },
  kotSentAt:            { type: Date },

  // Billing
  subtotal:             { type: Number, default: 0 },
  taxAmount:            { type: Number, default: 0 },
  serviceChargePercent: { type: Number, default: 0 },
  serviceChargeAmount:  { type: Number, default: 0 },
  discountPercent:      { type: Number, default: 0 },
  discountAmount:       { type: Number, default: 0 },
  roundOff:             { type: Number, default: 0 },
  grandTotal:           { type: Number, default: 0 },
  amountPaid:           { type: Number, default: 0 },
  amountDue:            { type: Number, default: 0 },
  paymentStatus:        { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  paymentMethod:        { type: String, enum: ['cash', 'upi', 'card', 'bank', 'other'], default: 'cash' },

  // Discounts
  discountType:         { type: String, enum: ['percent', 'flat'], default: 'percent' },
  discountCode:         { type: String, trim: true },

  invoice:              { type: Schema.Types.ObjectId, ref: 'InventoryInvoice' },
  kots:                 [{ type: Schema.Types.ObjectId, ref: 'RestaurantKOT' }],
  notes:                { type: String, trim: true },
  billedAt:             { type: Date }
}, { timestamps: true });

restaurantOrderSchema.index({ restaurant: 1, status: 1, createdAt: -1 });
restaurantOrderSchema.index({ restaurant: 1, orderNumber: 1 }, { unique: true });
restaurantOrderSchema.index({ restaurant: 1, table: 1, status: 1 });

module.exports = mongoose.model('RestaurantOrder', restaurantOrderSchema);
