const mongoose = require('mongoose');

// One row per song actually started by a listener. RadioTrack.playCount is the
// running total; this collection is the time series behind it — which song, in
// which playlist, at what hour. Rows expire after 90 days so it can't grow
// without bound.
const radioPlaySchema = new mongoose.Schema({
  track:    { type: mongoose.Schema.Types.ObjectId, ref: 'RadioTrack',    default: null },
  playlist: { type: mongoose.Schema.Types.ObjectId, ref: 'RadioPlaylist', default: null },

  videoId:      { type: String, required: true },
  title:        { type: String, default: '' },
  playlistSlug: { type: String, default: '' },

  visitorToken: { type: String, default: '' },   // matches the site's existing visitor id
  istHour:      { type: Number, default: null }, // 0-23, for the "when do people listen" chart

  playedAt: { type: Date, default: Date.now }
}, { timestamps: false });

radioPlaySchema.index({ playedAt: -1 });
radioPlaySchema.index({ playlistSlug: 1, playedAt: -1 });
// TTL: drop rows older than 90 days.
radioPlaySchema.index({ playedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.models.RadioPlay ||
                 mongoose.model('RadioPlay', radioPlaySchema);
