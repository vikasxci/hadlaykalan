const mongoose = require('mongoose');

const eligibilityCriteriaSchema = new mongoose.Schema({
  min_age:          { type: Number },
  max_age:          { type: Number },
  max_income:       { type: Number },
  max_land:         { type: Number },
  min_land:         { type: Number },
  caste_categories: [{ type: String, enum: ['general', 'obc', 'sc', 'st', 'all'] }],
  gender:           { type: String, enum: ['male', 'female', 'all'], default: 'all' },
  occupation:       [{ type: String }],
  custom_notes:     { type: String }
}, { _id: false });

const schemeSchema = new mongoose.Schema({
  name_hi:             { type: String, required: true },
  name_en:             { type: String, required: true },
  category:            {
    type: String,
    enum: ['agriculture', 'education', 'health', 'housing', 'employment',
           'social_welfare', 'women_child', 'financial'],
    required: true
  },
  level:               { type: String, enum: ['central', 'state'], default: 'central' },
  ministry:            { type: String, required: true },
  description_hi:      { type: String, required: true },
  description_en:      { type: String },
  eligibility_criteria: { type: eligibilityCriteriaSchema, default: () => ({}) },
  benefits_hi:         { type: String, required: true },
  benefits_en:         { type: String },
  documents_required:  [{ type: String }],
  official_portal_url: { type: String },
  csc_help:            { type: Boolean, default: true },
  is_active:           { type: Boolean, default: true },
  is_featured:         { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.models.Scheme || mongoose.model('Scheme', schemeSchema);
