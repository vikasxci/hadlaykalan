const mongoose = require('mongoose');

const workPostSchema = new mongoose.Schema({
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser', required: true },
  // Post type: 'need_worker' = employer looking for workers, 'available_worker' = worker offering services
  postType: {
    type: String,
    required: true,
    enum: ['need_worker', 'available_worker'],
    default: 'need_worker'
  },
  // Work details
  workType: { 
    type: String, 
    required: true,
    enum: ['buayi', 'katai', 'pani', 'ropai', 'nirdan', 'khad', 'jate', 'construction', 'cleaning', 'painting', 'plumbing', 'electrical', 'loading', 'other']
  },
  customWorkType: { type: String, trim: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  
  // Payment info (for employer posts)
  paymentType: { 
    type: String, 
    enum: ['hourly', 'daily', 'monthly', 'yearly', 'fixed']
  },
  amount: { type: Number, min: 0 },
  
  // Worker rates (for worker/available_worker posts)
  dailyRate: { type: Number, min: 0 },
  monthlyRate: { type: Number, min: 0 },
  yearlyRate: { type: Number, min: 0 },
  
  // Requirements
  workersNeeded: { type: Number, default: 1, min: 1 },
  startDate: { type: Date },
  duration: { type: String, trim: true },
  location: { type: String, trim: true },
  
  // Status
  status: { type: String, default: 'active', enum: ['active', 'closed', 'completed'] },
  
  // Accepted workers (for employer posts - workers accept)
  acceptedBy: [{
    worker: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser' },
    acceptedAt: { type: Date, default: Date.now }
  }],

  // Hired by (for worker posts - employers show interest to hire)
  hiredBy: [{
    employer: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkerUser' },
    hiredAt: { type: Date, default: Date.now }
  }],
  
  isApproved: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('WorkPost', workPostSchema);
