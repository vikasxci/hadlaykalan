const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'sarpanch', 'contest_admin', 'market_rate', 'subadmin'], default: 'admin' },
  permissions: { type: [String], default: [] }, // section keys allowed for subadmin role
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }, // who created this subadmin
  lastLogin: { type: Date },
  loginCount: { type: Number, default: 0 }
}, { timestamps: true });

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

adminSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
