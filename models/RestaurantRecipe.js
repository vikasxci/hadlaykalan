const mongoose = require('mongoose');
const { Schema } = mongoose;

const ingredientSchema = new Schema({
  item:           { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
  itemName:       { type: String, required: true, trim: true },
  quantity:       { type: Number, required: true, min: 0 },
  unit:           { type: String, default: 'g' },
  wastagePercent: { type: Number, default: 0, min: 0, max: 100 },
  costPerUnit:    { type: Number, default: 0 },
  totalCost:      { type: Number, default: 0 }  // (quantity × costPerUnit) × (1 + wastage/100)
}, { _id: false });

const restaurantRecipeSchema = new Schema({
  restaurant:   { type: Schema.Types.ObjectId, ref: 'RestaurantBusiness', required: true },
  menuItem:     { type: Schema.Types.ObjectId, ref: 'RestaurantMenuItem', required: true },
  servings:     { type: Number, default: 1 },   // recipe yields this many portions
  ingredients:  [ingredientSchema],
  totalCost:    { type: Number, default: 0 },   // sum of ingredient totalCosts
  instructions: { type: String, trim: true },
  notes:        { type: String, trim: true }
}, { timestamps: true });

restaurantRecipeSchema.index({ restaurant: 1, menuItem: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantRecipe', restaurantRecipeSchema);
