const mongoose = require('mongoose');

const mandiRateSchema = new mongoose.Schema({
  crop: { type: String, required: true },
  price: { type: Number, required: true },
  unit: { type: String, default: 'per quintal' },
  market: { type: String, default: 'Local Mandi' },
  trend: { type: String, enum: ['up', 'down', 'stable'], default: 'stable' },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

const farmerTipSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  category: { type: String, enum: ['crop', 'weather', 'scheme', 'tips', 'market'], default: 'tips' },
  image: { type: String },
  cloudinaryId: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const mandiCropSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  nameHi: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const mandiMarketSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  location: { type: String, trim: true, default: '' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const MandiRate = mongoose.models.MandiRate || mongoose.model('MandiRate', mandiRateSchema);
const FarmerTip = mongoose.models.FarmerTip || mongoose.model('FarmerTip', farmerTipSchema);
const MandiCrop = mongoose.models.MandiCrop || mongoose.model('MandiCrop', mandiCropSchema);
const MandiMarket = mongoose.models.MandiMarket || mongoose.model('MandiMarket', mandiMarketSchema);

module.exports = { MandiRate, FarmerTip, MandiCrop, MandiMarket };
