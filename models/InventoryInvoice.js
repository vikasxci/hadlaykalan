const mongoose = require('mongoose');
const { Schema } = mongoose;

const lineItemSchema = new Schema({
  item:        { type: Schema.Types.ObjectId, ref: 'InventoryItem' },
  name:        { type: String, required: true },
  sku:         { type: String },
  hsnCode:     { type: String },
  unit:        { type: String, default: 'piece' },
  qty:         { type: Number, required: true, min: 0.001 },
  price:       { type: Number, required: true, min: 0 },
  discountPct: { type: Number, default: 0 },
  taxRate:     { type: Number, default: 0 },
  taxAmount:   { type: Number, default: 0 },
  lineTotal:   { type: Number, default: 0 },
}, { _id: false });

const inventoryInvoiceSchema = new Schema({
  business:        { type: Schema.Types.ObjectId, ref: 'InventoryBusiness', required: true },
  invoiceNumber:   { type: String, required: true },

  // Customer reference + snapshot (invoice is self-contained)
  customer:        { type: Schema.Types.ObjectId, ref: 'InventoryCustomer' },
  customerName:    { type: String, trim: true },
  customerPhone:   { type: String, trim: true },
  customerEmail:   { type: String, trim: true },
  customerAddress: { type: String, trim: true },
  customerGstin:   { type: String, trim: true },

  items:           [lineItemSchema],

  subtotal:        { type: Number, default: 0 },
  discountAmount:  { type: Number, default: 0 },
  taxAmount:       { type: Number, default: 0 },
  grandTotal:      { type: Number, default: 0 },
  amountPaid:      { type: Number, default: 0 },
  amountDue:       { type: Number, default: 0 },

  paymentStatus:   { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  paymentMethod:   { type: String, enum: ['cash', 'upi', 'card', 'bank', 'credit', 'other'], default: 'cash' },

  invoiceDate:     { type: Date, default: Date.now },
  dueDate:         { type: Date },

  notes:           { type: String, trim: true },
  terms:           { type: String, trim: true },
  status:          { type: String, enum: ['draft', 'sent', 'paid', 'cancelled'], default: 'draft' },

  // Source tracking
  source:           { type: String, enum: ['inventory', 'restaurant'], default: 'inventory' },
  restaurantOrder:  { type: Schema.Types.ObjectId, ref: 'RestaurantOrder' },
}, { timestamps: true });

inventoryInvoiceSchema.index({ business: 1, invoiceDate: -1 });
inventoryInvoiceSchema.index({ business: 1, customer: 1 });
inventoryInvoiceSchema.index({ business: 1, invoiceNumber: 1 }, { unique: true });
inventoryInvoiceSchema.index({ business: 1, paymentStatus: 1 });

module.exports = mongoose.model('InventoryInvoice', inventoryInvoiceSchema);
