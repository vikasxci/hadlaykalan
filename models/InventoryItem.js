const mongoose = require('mongoose');
const { Schema } = mongoose;

const inventoryItemSchema = new Schema({
  business: { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },

  // ── Basic Identity ──────────────────────────────────
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  sku:         { type: String, trim: true },  // Stock Keeping Unit
  barcode:     { type: String, trim: true },  // EAN-13 / UPC / QR
  hsnCode:     { type: String, trim: true },  // HSN/SAC for GST filing
  internalCode:{ type: String, trim: true },  // Business internal code

  // ── Classification ──────────────────────────────────
  category:    { type: Schema.Types.ObjectId, ref: 'InventoryCategory' },
  subcategory: { type: String, trim: true },
  brand:       { type: String, trim: true },
  model:       { type: String, trim: true },  // Model number
  tags:        [{ type: String, trim: true }],

  // ── Pricing ──────────────────────────────────────────
  costPrice:       { type: Number, min: 0, default: 0 }, // Purchase cost per unit
  sellingPrice:    { type: Number, min: 0, default: 0 }, // Listed selling price
  mrp:             { type: Number, min: 0 },             // Max Retail Price
  wholesalePrice:  { type: Number, min: 0 },             // B2B bulk price
  discountPercent: { type: Number, min: 0, max: 100, default: 0 },

  // ── Tax ───────────────────────────────────────────────
  taxType:     { type: String, enum: ['none', 'gst', 'igst', 'vat', 'other'], default: 'gst' },
  taxRate:     { type: Number, min: 0, max: 100, default: 0 }, // e.g. 18 for 18% GST
  taxIncluded: { type: Boolean, default: false },              // Is price tax-inclusive?
  cgst:        { type: Number, min: 0, default: 0 },          // CGST %
  sgst:        { type: Number, min: 0, default: 0 },          // SGST %

  // ── Units ─────────────────────────────────────────────
  unit:             { type: String, default: 'piece' }, // piece, kg, litre, metre, box, pack…
  secondaryUnit:    { type: String },                   // e.g. box -> piece
  conversionFactor: { type: Number },                   // 1 box = N pieces

  // ── Stock ─────────────────────────────────────────────
  currentStock:  { type: Number, default: 0 },
  minStock:      { type: Number, default: 0 },   // Low-stock alert threshold
  maxStock:      { type: Number },               // Upper cap
  reorderPoint:  { type: Number, default: 0 },   // Trigger reorder at this level
  reorderQty:    { type: Number, default: 0 },   // Suggested order quantity
  openingStock:  { type: Number, default: 0 },   // Starting inventory (for P&L)

  // ── Location ──────────────────────────────────────────
  warehouse: { type: String, trim: true },
  shelf:     { type: String, trim: true },  // Shelf / Rack / Bin

  // ── Physical Attributes ───────────────────────────────
  weight:     { type: Number },
  weightUnit: { type: String, enum: ['mg', 'g', 'kg', 'lb', 'oz'], default: 'kg' },
  dimensions: {
    length: { type: Number },
    width:  { type: Number },
    height: { type: Number },
    unit:   { type: String, enum: ['mm', 'cm', 'inch', 'm'], default: 'cm' }
  },
  color: { type: String, trim: true },
  size:  { type: String, trim: true },    // S/M/L/XL or numeric
  material: { type: String, trim: true },

  // ── Batch / Expiry Tracking ───────────────────────────
  isBatchTracked:    { type: Boolean, default: false },
  isExpiryTracked:   { type: Boolean, default: false },
  defaultExpiryDays: { type: Number },  // default shelf life in days

  // ── Supplier ──────────────────────────────────────────
  preferredSupplier: { type: Schema.Types.ObjectId, ref: 'InventorySupplier' },
  supplierSKU:       { type: String, trim: true },  // Supplier's part number
  leadTimeDays:      { type: Number, default: 0 },

  // ── Media ─────────────────────────────────────────────
  images: [{ type: String }],  // Cloudinary URLs

  // ── Flags ─────────────────────────────────────────────
  isActive:           { type: Boolean, default: true },
  isService:          { type: Boolean, default: false },   // Non-physical; no stock tracking
  isSerialized:       { type: Boolean, default: false },   // Track by serial number
  allowNegativeStock: { type: Boolean, default: false },
  isFeatured:         { type: Boolean, default: false },

  // ── Analytics / ML Features ───────────────────────────
  totalSold:           { type: Number, default: 0 },
  totalPurchased:      { type: Number, default: 0 },
  totalRevenue:        { type: Number, default: 0 },
  totalCost:           { type: Number, default: 0 },
  totalReturnQty:      { type: Number, default: 0 },
  totalAdjustments:    { type: Number, default: 0 },
  lastSoldAt:          { type: Date },
  lastPurchasedAt:     { type: Date },
  lastStockUpdateAt:   { type: Date },
  avgDailySales:       { type: Number, default: 0 },   // rolling 30-day avg
  grossMarginPercent:  { type: Number, default: 0 },   // (selling - cost) / cost * 100

  // ── Notes ─────────────────────────────────────────────
  notes: { type: String, trim: true }

}, { timestamps: true });

// Compound indexes
inventoryItemSchema.index({ business: 1, name: 1 });
inventoryItemSchema.index({ business: 1, sku: 1 });
inventoryItemSchema.index({ business: 1, barcode: 1 });
inventoryItemSchema.index({ business: 1, category: 1 });
inventoryItemSchema.index({ business: 1, isActive: 1, currentStock: 1 });

// Virtual: profit margin
inventoryItemSchema.virtual('marginAmount').get(function () {
  return this.sellingPrice - this.costPrice;
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
