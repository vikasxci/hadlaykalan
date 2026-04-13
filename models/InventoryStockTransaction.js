const mongoose = require('mongoose');
const { Schema } = mongoose;

// Helper: derive season from month
function getSeason(month) {
  if ([3, 4].includes(month))        return 'spring';
  if ([5, 6].includes(month))        return 'summer';
  if ([7, 8, 9].includes(month))     return 'monsoon';
  if ([10, 11].includes(month))      return 'autumn';
  return 'winter'; // 12, 1, 2
}

const inventoryStockTransactionSchema = new Schema({
  business: { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },
  item:     { type: Schema.Types.ObjectId, ref: 'InventoryItem',    required: true },

  // Transaction Type
  type: {
    type: String,
    required: true,
    enum: [
      'purchase',       // stock came in from supplier
      'sale',           // stock went out to customer
      'adjustment_in',  // manual positive correction
      'adjustment_out', // manual negative correction
      'return_in',      // customer returned goods
      'return_out',     // goods returned to supplier
      'transfer_in',    // received from another location
      'transfer_out',   // sent to another location
      'opening',        // opening balance entry
      'damage',         // damaged/written-off stock
      'expired'         // expired stock write-off
    ]
  },

  // Quantity & Stock Levels
  quantity:       { type: Number, required: true },  // always positive; direction = type
  quantityBefore: { type: Number },
  quantityAfter:  { type: Number },
  unit:           { type: String, trim: true },

  // Batch / Lot (for ML & compliance)
  batchNo:         { type: String, trim: true },
  lotNo:           { type: String, trim: true },
  serialNo:        { type: String, trim: true },
  manufactureDate: { type: Date },
  expiryDate:      { type: Date },

  // Financial
  unitPrice:   { type: Number, default: 0 },   // cost if purchase; selling price if sale
  discount:    { type: Number, default: 0 },   // discount amount per unit
  taxAmount:   { type: Number, default: 0 },   // tax amount total
  totalAmount: { type: Number, default: 0 },   // final total

  // Reference Document
  referenceType: { type: String, enum: ['purchase_order', 'sale_invoice', 'manual', 'transfer', 'return', 'other'] },
  referenceId:   { type: Schema.Types.ObjectId },
  referenceNo:   { type: String, trim: true },  // Invoice / challan number

  // Supplier (for purchase transactions)
  supplier:      { type: Schema.Types.ObjectId, ref: 'InventorySupplier' },
  supplierName:  { type: String, trim: true },  // Denormalized for history

  // Customer (for sale transactions)
  customerName:  { type: String, trim: true },
  customerPhone: { type: String, trim: true },
  customerEmail: { type: String, trim: true },

  // Audit
  notes:     { type: String, trim: true },
  createdBy: { type: String, trim: true },  // owner name / user id

  // ── ML Features (time-series enrichment) ─────────────
  dayOfWeek:   { type: Number, min: 0, max: 6 },  // 0=Sun…6=Sat
  hour:        { type: Number, min: 0, max: 23 },
  month:       { type: Number, min: 1, max: 12 },
  year:        { type: Number },
  weekOfYear:  { type: Number },
  season:      { type: String, enum: ['spring', 'summer', 'monsoon', 'autumn', 'winter'] },
  isWeekend:   { type: Boolean }

}, { timestamps: true });

// Auto-populate ML time fields before saving
inventoryStockTransactionSchema.pre('save', function (next) {
  const now = this.createdAt || new Date();
  this.dayOfWeek  = now.getDay();
  this.hour       = now.getHours();
  this.month      = now.getMonth() + 1;
  this.year       = now.getFullYear();
  this.season     = getSeason(this.month);
  this.isWeekend  = this.dayOfWeek === 0 || this.dayOfWeek === 6;

  // ISO week number
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  this.weekOfYear = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  next();
});

// Indexes
inventoryStockTransactionSchema.index({ business: 1, item: 1, createdAt: -1 });
inventoryStockTransactionSchema.index({ business: 1, type: 1, createdAt: -1 });
inventoryStockTransactionSchema.index({ business: 1, createdAt: -1 });

module.exports = mongoose.models.InventoryStockTransaction || mongoose.model('InventoryStockTransaction', inventoryStockTransactionSchema);
