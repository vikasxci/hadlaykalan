const mongoose = require('mongoose');
const { Schema } = mongoose;

const variantSchema = new Schema({
  name:  { type: String, required: true, trim: true },
  price: { type: Number, required: true, min: 0 }
}, { _id: false });

const restaurantMenuItemSchema = new Schema({
  restaurant:      { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  name:            { type: String, required: true, trim: true },
  description:     { type: String, trim: true },
  category:        { type: String, required: true, trim: true },
  // veg = pure vegetarian, non-veg = contains meat/fish, vegan = plant-only, egg = ovo-vegetarian
  type:            { type: String, enum: ['veg', 'non-veg', 'vegan', 'egg'], default: 'veg' },
  price:           { type: Number, required: true, min: 0 },
  variants:        [variantSchema],               // e.g. Half / Full pricing
  taxRate:         { type: Number, default: 5, min: 0, max: 100 },
  taxIncluded:     { type: Boolean, default: true },
  preparationTime: { type: Number, default: 15 }, // estimated cook time (minutes)
  image:           { type: String },
  allergens:       [{ type: String, trim: true }],
  tags:            [{ type: String, trim: true }],
  isAvailable:     { type: Boolean, default: true },
  isActive:        { type: Boolean, default: true },
  sortOrder:       { type: Number, default: 0 },
  costPrice:       { type: Number, default: 0 },
  modifierGroups:  [{ type: Schema.Types.ObjectId, ref: 'RestaurantModifier' }],
  kitchenStation:  { type: String, default: 'Main Kitchen' }   // which station prepares this
}, { timestamps: true });

restaurantMenuItemSchema.index({ restaurant: 1, category: 1, sortOrder: 1 });
restaurantMenuItemSchema.index({ restaurant: 1, isAvailable: 1, isActive: 1 });

module.exports = mongoose.model('RestaurantMenuItem', restaurantMenuItemSchema);
