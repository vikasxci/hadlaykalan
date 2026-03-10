const mongoose = require('mongoose');

// Schema for a single contestant in a contest
const contestantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  age: { type: Number },
  village: { type: String, trim: true },
  bio: { type: String, trim: true, maxlength: 200 },
  image: { type: String, required: true },
  cloudinaryId: { type: String },
  votes: { type: Number, default: 0 },
  voterTokens: [{ type: String }], // Visitor tokens that voted for this contestant
  voterIPs: [{ type: String }], // IP addresses that voted for this contestant
  isApproved: { type: Boolean, default: false },
  submittedAt: { type: Date, default: Date.now }
});

// Main Contest schema - 1v1 battle
const contestSchema = new mongoose.Schema({
  title: { type: String, trim: true, default: 'Photo Contest' },
  contestType: { type: String, trim: true, default: 'Photo Contest' }, // e.g. Photo Contest, Selfie Contest, Best Smile etc.
  contestantA: contestantSchema,
  contestantB: contestantSchema,
  status: {
    type: String,
    enum: ['waiting', 'active', 'completed'],
    default: 'waiting'
    // waiting  = only contestantA submitted, waiting for B
    // active   = both contestants approved & battle live
    // completed = 24h passed, winner declared
  },
  winner: { type: String, enum: ['A', 'B', 'tie', null], default: null },
  startedAt: { type: Date }, // When battle went active (both approved)
  endsAt: { type: Date },    // startedAt + 24h
  allVoterTokens: [{ type: String }], // All visitor tokens that voted in this contest (for uniqueness)
  allVoterIPs: [{ type: String }], // All IP addresses that voted in this contest (for uniqueness)
  createdAt: { type: Date, default: Date.now }
});

// Virtual to check if contest has ended
contestSchema.virtual('isExpired').get(function () {
  if (!this.endsAt) return false;
  return new Date() >= this.endsAt;
});

// Method to declare winner
contestSchema.methods.declareWinner = function () {
  if (!this.contestantA || !this.contestantB) return;
  const votesA = this.contestantA.votes || 0;
  const votesB = this.contestantB.votes || 0;
  if (votesA > votesB) this.winner = 'A';
  else if (votesB > votesA) this.winner = 'B';
  else this.winner = 'tie';
  this.status = 'completed';
};

contestSchema.set('toJSON', { virtuals: true });
contestSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Contest', contestSchema);
