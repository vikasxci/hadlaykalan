const mongoose = require('mongoose');

// Stores the fat-based rate chart and flat rates
const mcsTariffSchema = new mongoose.Schema({
  animalType: { type: String, enum: ['cow', 'buffalo'], required: true },
  rateType:   { type: String, enum: ['flat', 'fat_based'], default: 'flat' },
  flatRate:   { type: Number, default: 0 }, // ₹ per litre (if rateType=flat)
  // Fat-based: array of { minFat, maxFat, ratePerLitre }
  fatRates: [
    {
      minFat:       { type: Number },
      maxFat:       { type: Number },
      ratePerLitre: { type: Number }
    }
  ],
  isActive:   { type: Boolean, default: true },
  updatedAt:  { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('MCSTariff', mcsTariffSchema);
