const mongoose = require('mongoose');
const { Schema } = mongoose;

const restaurantTableSchema = new Schema({
  restaurant:   { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  tableNo:      { type: String, required: true, trim: true },
  area:         { type: String, default: 'Main Hall', trim: true },
  seats:        { type: Number, default: 2, min: 1 },
  status: {
    type: String,
    enum: ['available', 'occupied', 'reserved', 'dirty', 'out-of-service'],
    default: 'available'
  },
  currentOrder: { type: Schema.Types.ObjectId, ref: 'RestaurantOrder', default: null },
  notes:        { type: String, trim: true },
  isActive:     { type: Boolean, default: true }
}, { timestamps: true });

restaurantTableSchema.index({ restaurant: 1, tableNo: 1 }, { unique: true });
restaurantTableSchema.index({ restaurant: 1, status: 1 });

module.exports = mongoose.model('RestaurantTable', restaurantTableSchema);
