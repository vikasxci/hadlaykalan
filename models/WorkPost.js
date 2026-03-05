const mongoose = require('mongoose');

const workPostSchema = new mongoose.Schema({
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser', required: true },
  // Work details
  workType: { 
    type: String, 
    required: true,
    enum: ['buayi', 'katai', 'pani', 'ropai', 'nirdan', 'khad', 'jate', 'construction', 'cleaning', 'painting', 'plumbing', 'electrical', 'loading', 'other']
  },
  customWorkType: { type: String, trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  
  // Payment info
  paymentType: { 
    type: String, 
    required: true,
    enum: ['hourly', 'daily', 'monthly', 'yearly', 'fixed']
  },
  amount: { type: Number, required: true, min: 0 },
  
  // Requirements
  workersNeeded: { type: Number, default: 1, min: 1 },
  startDate: { type: Date },
  duration: { type: String, trim: true },
  location: { type: String, trim: true },
  
  // Status
  status: { type: String, default: 'active', enum: ['active', 'closed', 'completed'] },
  
  // Accepted workers
  acceptedBy: [{
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser' },
    acceptedAt: { type: Date, default: Date.now }
  }],
  
  isApproved: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('WorkPost', workPostSchema);
