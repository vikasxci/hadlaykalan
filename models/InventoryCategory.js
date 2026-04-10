const mongoose = require('mongoose');
const { Schema } = mongoose;

const inventoryCategorySchema = new Schema({
  business:       { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },
  name:           { type: String, required: true, trim: true },
  description:    { type: String, trim: true },
  parentCategory: { type: Schema.Types.ObjectId, ref: 'InventoryCategory', default: null },
  icon:           { type: String, trim: true },  // emoji or icon class
  color:          { type: String, default: '#6366f1' },
  sortOrder:      { type: Number, default: 0 },
  isActive:       { type: Boolean, default: true },

  // ML: track item count per category
  itemCount:      { type: Number, default: 0 }
}, { timestamps: true });

inventoryCategorySchema.index({ business: 1, name: 1 });

module.exports = mongoose.model('InventoryCategory', inventoryCategorySchema);
