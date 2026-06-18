const express = require('express');
const router = express.Router();
const Scheme = require('../models/Scheme');
const auth = require('../middleware/auth');

// Public: get all active schemes
router.get('/', async (req, res) => {
  try {
    const schemes = await Scheme.find({ is_active: true }).sort({ is_featured: -1, createdAt: -1 });
    res.json(schemes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: get all schemes including inactive
router.get('/admin/all', auth, async (req, res) => {
  try {
    const schemes = await Scheme.find().sort({ createdAt: -1 });
    res.json(schemes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Public: get single scheme
router.get('/:id', async (req, res) => {
  try {
    const scheme = await Scheme.findById(req.params.id);
    if (!scheme) return res.status(404).json({ message: 'Scheme not found' });
    res.json(scheme);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: create scheme
router.post('/', auth, async (req, res) => {
  try {
    const scheme = new Scheme(buildSchemeData(req.body));
    await scheme.save();
    res.status(201).json(scheme);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: update scheme
router.put('/:id', auth, async (req, res) => {
  try {
    const scheme = await Scheme.findByIdAndUpdate(
      req.params.id,
      { $set: buildSchemeData(req.body) },
      { new: true, runValidators: true }
    );
    if (!scheme) return res.status(404).json({ message: 'Scheme not found' });
    res.json(scheme);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin: delete scheme
router.delete('/:id', auth, async (req, res) => {
  try {
    const scheme = await Scheme.findByIdAndDelete(req.params.id);
    if (!scheme) return res.status(404).json({ message: 'Scheme not found' });
    res.json({ message: 'Scheme deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

function buildSchemeData(body) {
  const docs = body.documents_required;
  const data = {
    name_hi:             body.name_hi,
    name_en:             body.name_en,
    category:            body.category,
    level:               body.level || 'central',
    ministry:            body.ministry,
    description_hi:      body.description_hi,
    description_en:      body.description_en,
    benefits_hi:         body.benefits_hi,
    benefits_en:         body.benefits_en,
    documents_required:  Array.isArray(docs) ? docs : (docs ? docs.split(',').map(d => d.trim()).filter(Boolean) : []),
    official_portal_url: body.official_portal_url,
    csc_help:            body.csc_help !== undefined ? body.csc_help === 'true' || body.csc_help === true : true,
    is_active:           body.is_active !== undefined ? body.is_active === 'true' || body.is_active === true : true,
    is_featured:         body.is_featured === 'true' || body.is_featured === true,
    eligibility_criteria: {
      min_age:          body.elg_min_age   ? Number(body.elg_min_age)   : undefined,
      max_age:          body.elg_max_age   ? Number(body.elg_max_age)   : undefined,
      max_income:       body.elg_max_income ? Number(body.elg_max_income) : undefined,
      max_land:         body.elg_max_land  ? Number(body.elg_max_land)  : undefined,
      min_land:         body.elg_min_land  ? Number(body.elg_min_land)  : undefined,
      caste_categories: body.elg_caste_categories
        ? (Array.isArray(body.elg_caste_categories) ? body.elg_caste_categories : [body.elg_caste_categories])
        : [],
      gender:           body.elg_gender    || 'all',
      occupation:       body.elg_occupation
        ? (Array.isArray(body.elg_occupation) ? body.elg_occupation : [body.elg_occupation])
        : [],
      custom_notes:     body.elg_custom_notes
    }
  };
  return data;
}

module.exports = router;
