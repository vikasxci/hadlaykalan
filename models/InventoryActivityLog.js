const mongoose = require('mongoose');
const { Schema } = mongoose;

const inventoryActivityLogSchema = new Schema({
  business:     { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true, index: true },
  businessName: { type: String },
  ownerEmail:   { type: String },

  action: {
    type: String,
    required: true,
    enum: [
      'login', 'logout', 'register',
      'item_create', 'item_update', 'item_delete',
      'category_create', 'category_update', 'category_delete',
      'supplier_create', 'supplier_update', 'supplier_delete',
      'transaction_create',
      'profile_update',
    ]
  },

  entity:     { type: String },  // 'item', 'category', 'supplier', 'transaction', 'business'
  entityId:   { type: Schema.Types.ObjectId },
  entityName: { type: String },  // e.g. item name, category name

  details:    { type: Schema.Types.Mixed },  // extra info object
  ip:         { type: String },
  userAgent:  { type: String },
}, {
  timestamps: true
});

inventoryActivityLogSchema.index({ business: 1, createdAt: -1 });
inventoryActivityLogSchema.index({ action: 1, createdAt: -1 });
inventoryActivityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('InventoryActivityLog', inventoryActivityLogSchema);
module.exports = mongoose.model('InventoryActivityLog', inventoryActivityLogSchema);
