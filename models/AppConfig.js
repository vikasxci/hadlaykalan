const mongoose = require('mongoose');

// Generic key-value store for app-wide configuration.
// Each setting is one document: { key: 'apkUrl', value: 'https://...' }
const appConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);
