const mongoose = require('mongoose');

const mcsCollectionSchema = new mongoose.Schema({
  customer:   { type: mongoose.Schema.Types.ObjectId, ref: 'MCSCustomer', required: true },
  date:       { type: String, required: true }, // 'YYYY-MM-DD'
  shift:      { type: String, enum: ['morning', 'evening'], required: true },
  animalType: { type: String, enum: ['cow', 'buffalo'], required: true },
  qty:        { type: Number, required: true, min: 0 },   // litres
  fat:        { type: Number, default: 0 },               // fat %
  snf:        { type: Number, default: 0 },               // SNF %
  ratePerLitre: { type: Number, required: true },
  amount:     { type: Number, required: true },            // qty × rate
  note:       { type: String, trim: true },
  createdAt:  { type: Date, default: Date.now }
});

// Composite uniqueness: one entry per customer per date per shift
mcsCollectionSchema.index({ customer: 1, date: 1, shift: 1 }, { unique: true });

module.exports = mongoose.model('MCSCollection', mcsCollectionSchema);
