const mongoose = require('mongoose');

const mcsPaymentSchema = new mongoose.Schema({
  customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'MCSCustomer', required: true },
  amount:      { type: Number, required: true },
  // period this payment covers: 'YYYY-MM'
  period:      { type: String, trim: true },
  paymentDate: { type: String, required: true }, // 'YYYY-MM-DD'
  method:      { type: String, enum: ['cash', 'upi', 'bank', 'other'], default: 'cash' },
  note:        { type: String, trim: true },
  createdAt:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('MCSPayment', mcsPaymentSchema);
