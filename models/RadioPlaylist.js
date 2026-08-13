const mongoose = require('mongoose');

const radioPlaylistSchema = new mongoose.Schema({
  slug:  { type: String, required: true, unique: true, trim: true, lowercase: true },
  name:  { type: String, required: true, trim: true },   // Hindi label shown on the site
  emoji: { type: String, default: '🎵' },

  // Time-of-day auto-tune, in Asia/Kolkata hours. [istStart, istEnd) — a
  // wrapping range like 23 → 5 is valid. Leave both null for a playlist that
  // is only reachable from the dropdown.
  istStart: { type: Number, min: 0, max: 23, default: null },
  istEnd:   { type: Number, min: 0, max: 23, default: null },

  // Where the tracks came from, so the admin can re-sync in one click.
  sourceUrl:        { type: String, default: '' },
  sourcePlaylistId: { type: String, default: '' },
  lastSyncedAt:     { type: Date, default: null },
  lastSyncCount:    { type: Number, default: 0 },
  lastSyncMethod:   { type: String, default: '' },   // 'api' | 'scrape'

  order:     { type: Number, default: 0 },
  isActive:  { type: Boolean, default: true },
  playCount: { type: Number, default: 0 }
}, { timestamps: true });

radioPlaylistSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.models.RadioPlaylist ||
                 mongoose.model('RadioPlaylist', radioPlaylistSchema);
