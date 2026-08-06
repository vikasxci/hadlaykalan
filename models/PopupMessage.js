const mongoose = require('mongoose');

// One input the popup asks the user for.
// `saveTo` decides where the answer is persisted on the user's profile
// (Visitor for web, AndroidDevice for the app) — 'none' keeps it in the
// popup response only.
const popupFieldSchema = new mongoose.Schema({
  key:         { type: String, required: true },   // 'name', 'phone', 'age', ...
  label:       { type: String, required: true },   // shown above the input
  type:        { type: String, enum: ['text', 'tel', 'email', 'number', 'textarea', 'select'], default: 'text' },
  placeholder: { type: String, default: '' },
  required:    { type: Boolean, default: true },
  options:     [{ type: String }],                 // for type 'select'
  saveTo:      { type: String, enum: ['name', 'phone', 'profession', 'area', 'none'], default: 'none' }
}, { _id: false });

const popupMessageSchema = new mongoose.Schema({
  title:   { type: String, required: true },
  message: { type: String, required: true },
  emoji:   { type: String, default: '📢' },
  image:        { type: String },
  cloudinaryId: { type: String },

  // 'closable'     — user can dismiss with X / Later / backdrop
  // 'non_closable' — blocking: no X, no backdrop close, no Esc. If the popup
  //                  collects info the user cannot proceed until every
  //                  required field is filled and submitted.
  displayType: { type: String, enum: ['closable', 'non_closable'], default: 'closable' },

  collectInfo: { type: Boolean, default: false },
  fields:      { type: [popupFieldSchema], default: [] },

  ctaText:     { type: String, default: 'ठीक है / OK' },
  ctaUrl:      { type: String, default: '' },      // optional link opened after submit
  dismissText: { type: String, default: 'बाद में / Later' },

  // Who sees it
  audience: { type: String, enum: ['all', 'web', 'app', 'registered', 'unregistered'], default: 'all' },

  // How often it comes back for the same user
  // 'until_submitted' is forced for blocking popups that collect info
  frequency: { type: String, enum: ['once', 'once_per_day', 'every_visit', 'until_submitted'], default: 'once' },

  delaySeconds: { type: Number, default: 2 },      // wait before showing
  startAt: { type: Date },
  endAt:   { type: Date },
  priority: { type: Number, default: 0 },          // higher wins when several match
  isActive: { type: Boolean, default: true },

  // Stats
  viewCount:    { type: Number, default: 0 },
  submitCount:  { type: Number, default: 0 },
  dismissCount: { type: Number, default: 0 },

  createdBy: { type: String, default: 'Admin' }
}, { timestamps: true });

popupMessageSchema.index({ isActive: 1, priority: -1, createdAt: -1 });

// A blocking popup that asks for info must keep coming back until it is filled.
popupMessageSchema.pre('save', function (next) {
  if (this.displayType === 'non_closable' && this.collectInfo) {
    this.frequency = 'until_submitted';
  }
  if (!this.collectInfo) this.fields = [];
  next();
});

module.exports = mongoose.models.PopupMessage || mongoose.model('PopupMessage', popupMessageSchema);
