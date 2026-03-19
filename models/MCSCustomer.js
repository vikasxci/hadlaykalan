const mongoose = require('mongoose');

const mcsCustomerSchema = new mongoose.Schema({
  customerId: { type: String, unique: true, trim: true }, // e.g. C001
  name:       { type: String, required: true, trim: true },
  phone:      { type: String, trim: true },
  address:    { type: String, trim: true },
  animalType: { type: String, enum: ['cow', 'buffalo', 'both'], default: 'buffalo' },
  // Simple PIN for customer self-login (4-6 digit)
  pin:        { type: String, default: '1234' },
  isActive:   { type: Boolean, default: true },
  note:       { type: String, trim: true },
  balance:    { type: Number, default: 0 }, // Running balance (positive = amount owed to customer)
  createdAt:  { type: Date, default: Date.now }
});

// Auto-generate customerId before save if not set
mcsCustomerSchema.pre('save', async function (next) {
  if (!this.customerId) {
    const count = await mongoose.model('MCSCustomer').countDocuments();
    this.customerId = 'C' + String(count + 1).padStart(3, '0');
  }
  next();
});

module.exports = mongoose.model('MCSCustomer', mcsCustomerSchema);
