const mongoose = require('mongoose');
const { Schema } = mongoose;

const kotItemSchema = new Schema({
  menuItem:  { type: Schema.Types.ObjectId, ref: 'RestaurantMenuItem' },
  name:      { type: String, required: true },
  variant:   { type: String, default: '' },
  qty:       { type: Number, required: true, min: 1 },
  modifiers: [{ name: String, option: String, price: Number }],
  notes:     { type: String, trim: true },   // e.g. "no onion", "extra spicy"
  station:   { type: String, default: 'Main Kitchen' },
  status: {
    type: String,
    enum: ['pending', 'preparing', 'ready', 'served', 'cancelled'],
    default: 'pending'
  },
  readyAt: { type: Date }
}, { _id: true });

const restaurantKOTSchema = new Schema({
  restaurant:  { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  order:       { type: Schema.Types.ObjectId, ref: 'RestaurantOrder', required: true },
  kotNumber:   { type: String, required: true },

  // Where
  tableNo:  { type: String },
  area:     { type: String },
  type:     { type: String, enum: ['dine-in', 'takeaway', 'delivery'], default: 'dine-in' },

  // Who
  waiter:   { type: Schema.Types.ObjectId, ref: 'RestaurantStaff' },
  waiterName: { type: String },

  items: [kotItemSchema],

  // KOT classification
  kotType: {
    type: String,
    enum: ['new', 'add', 'modify', 'cancel'],
    default: 'new'
  },

  status: {
    type: String,
    enum: ['pending', 'printing', 'printed', 'preparing', 'ready', 'cancelled'],
    default: 'pending'
  },

  printCount:  { type: Number, default: 0 },
  printedAt:   { type: Date },
  completedAt: { type: Date }

}, { timestamps: true });

restaurantKOTSchema.index({ restaurant: 1, createdAt: -1 });
restaurantKOTSchema.index({ restaurant: 1, status: 1 });
restaurantKOTSchema.index({ order: 1 });

module.exports = mongoose.model('RestaurantKOT', restaurantKOTSchema);
