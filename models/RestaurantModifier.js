const mongoose = require('mongoose');
const { Schema } = mongoose;

const modifierOptionSchema = new Schema({
  name:      { type: String, required: true, trim: true },
  price:     { type: Number, default: 0 },       // 0 = no extra charge
  isDefault: { type: Boolean, default: false }
}, { _id: true });

const restaurantModifierSchema = new Schema({
  restaurant:  { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  groupName:   { type: String, required: true, trim: true },  // e.g. "Spice Level", "Add-ons", "Size"
  type: {
    type: String,
    enum: ['single', 'multi'],   // single = radio, multi = checkbox
    default: 'single'
  },
  required:   { type: Boolean, default: false },
  minSelect:  { type: Number, default: 0 },
  maxSelect:  { type: Number, default: 1 },
  options:    [modifierOptionSchema],

  // Which menu items this applies to (empty array = applies to all)
  appliesTo:  [{ type: Schema.Types.ObjectId, ref: 'RestaurantMenuItem' }],
  // Or apply to categories
  appliesToCategories: [{ type: String, trim: true }],

  sortOrder:  { type: Number, default: 0 },
  isActive:   { type: Boolean, default: true }

}, { timestamps: true });

restaurantModifierSchema.index({ restaurant: 1, isActive: 1 });

module.exports = mongoose.model('RestaurantModifier', restaurantModifierSchema);
