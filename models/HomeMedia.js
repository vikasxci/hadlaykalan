const mongoose = require('mongoose');

/* One card in the home-page media slider, sitting below the stories bar.
   Either a YouTube video that plays inline, or an image that may link
   somewhere. Ordered by `order` ascending — same convention as Slider. */
const homeMediaSchema = new mongoose.Schema({
  type: { type: String, enum: ['youtube', 'image'], required: true },

  title:   { type: String, trim: true },
  caption: { type: String, trim: true },

  // type: 'youtube' — the bare 11-character id. Whatever URL shape the admin
  // pastes (watch, youtu.be, embed, shorts) is normalised to this on save, so
  // the frontend never has to parse anything.
  videoId: { type: String, trim: true },

  // type: 'image'
  imageUrl:     { type: String, trim: true },
  cloudinaryId: { type: String },
  link:         { type: String, trim: true },

  isActive: { type: Boolean, default: true },
  order:    { type: Number, default: 0 }
}, { timestamps: true });

// The public listing is always "active, in order" — index it.
homeMediaSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.models.HomeMedia ||
                 mongoose.model('HomeMedia', homeMediaSchema);
