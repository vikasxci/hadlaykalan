const mongoose = require('mongoose');

const cricketPlayerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },

  batting: {
    innings:   { type: Number, default: 0 },
    runs:      { type: Number, default: 0 },
    balls:     { type: Number, default: 0 },
    notOuts:   { type: Number, default: 0 },
    highScore: { type: Number, default: 0 },
    fifties:   { type: Number, default: 0 },
    hundreds:  { type: Number, default: 0 },
  },

  bowling: {
    innings:     { type: Number, default: 0 },
    balls:       { type: Number, default: 0 },
    runs:        { type: Number, default: 0 },
    wickets:     { type: Number, default: 0 },
    bestWickets: { type: Number, default: 0 },
    bestRuns:    { type: Number, default: 0 },
    fiveWickets: { type: Number, default: 0 },
  },

  fielding: {
    catches: { type: Number, default: 0 },
    runOuts: { type: Number, default: 0 },
  },

  // Each entry is "<matchId>_<inningsIndex>" — prevents double-counting on re-runs
  processedInningsKeys: { type: [String], default: [], select: false },
}, { timestamps: true });

module.exports = mongoose.models.CricketPlayer || mongoose.model('CricketPlayer', cricketPlayerSchema);
