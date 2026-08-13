const mongoose = require('mongoose');

const radioTrackSchema = new mongoose.Schema({
  playlist: { type: mongoose.Schema.Types.ObjectId, ref: 'RadioPlaylist', required: true, index: true },

  videoId: { type: String, required: true, trim: true },   // 11-char YouTube id
  title:   { type: String, required: true, trim: true },   // the YouTube title, used as-is
  channel: { type: String, default: '' },
  durationSeconds: { type: Number, default: 0 },

  order:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },

  // Filled in by the play log so the admin can see what the village listens to.
  playCount:    { type: Number, default: 0 },
  lastPlayedAt: { type: Date, default: null },

  // Set when the YouTube player reports the upload can't be embedded, so a
  // dead track stops being served instead of making every listener skip it.
  errorCount:  { type: Number, default: 0 },
  lastErrorAt: { type: Date, default: null },
  errorReason: { type: String, default: '' }   // only set when actually retired
}, { timestamps: true });

// One row per video per playlist — re-importing a playlist updates instead of duplicating.
radioTrackSchema.index({ playlist: 1, videoId: 1 }, { unique: true });
radioTrackSchema.index({ playlist: 1, order: 1 });
radioTrackSchema.index({ playCount: -1 });

module.exports = mongoose.models.RadioTrack ||
                 mongoose.model('RadioTrack', radioTrackSchema);
