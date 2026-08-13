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

  // Failure tracking. A song is pulled from the playlist for everyone once it
  // is clearly broken — but "clearly" has to mean more than one person on a bad
  // connection, or a single village tower outage would empty the playlist.
  errorCount:  { type: Number, default: 0 },
  lastErrorAt: { type: Date, default: null },

  // Distinct listeners it has failed for. This, not the raw count, is what
  // decides whether the song is genuinely broken. Capped to stay small.
  errorTokens: { type: [String], default: [] },

  errorReason: { type: String, default: '' },   // human text, set when retired
  // Who took it out: 'youtube' (YouTube confirmed it is unplayable),
  // 'listeners' (it kept failing for different people), 'admin' (switched off
  // by hand). Drives what the repair pass is allowed to bring back.
  disabledBy:  { type: String, default: '' }
}, { timestamps: true });

// One row per video per playlist — re-importing a playlist updates instead of duplicating.
radioTrackSchema.index({ playlist: 1, videoId: 1 }, { unique: true });
radioTrackSchema.index({ playlist: 1, order: 1 });
radioTrackSchema.index({ playCount: -1 });

module.exports = mongoose.models.RadioTrack ||
                 mongoose.model('RadioTrack', radioTrackSchema);
