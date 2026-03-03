const express = require('express');
const router = express.Router();
const { MandiRate, FarmerTip } = require('../models/Farmer');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// ---- Mandi Rates ----
router.get('/mandi-rates', async (req, res) => {
  try {
    const rates = await MandiRate.find().sort({ date: -1, crop: 1 });
    res.json(rates);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/mandi-rates', auth, async (req, res) => {
  try {
    const rate = new MandiRate(req.body);
    await rate.save();
    res.status(201).json(rate);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/mandi-rates/:id', auth, async (req, res) => {
  try {
    const rate = await MandiRate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(rate);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/mandi-rates/:id', auth, async (req, res) => {
  try {
    await MandiRate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Rate deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- Farmer Tips ----
router.get('/tips', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    const tips = await FarmerTip.find(filter).sort({ createdAt: -1 });
    res.json(tips);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/tips/all', auth, async (req, res) => {
  try {
    const tips = await FarmerTip.find().sort({ createdAt: -1 });
    res.json(tips);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/tips', auth, upload.single('image'), async (req, res) => {
  try {
    const tipData = {
      title: req.body.title,
      content: req.body.content,
      category: req.body.category
    };
    if (req.file) {
      tipData.image = req.file.path;
      tipData.cloudinaryId = req.file.filename;
    }
    const tip = new FarmerTip(tipData);
    await tip.save();
    res.status(201).json(tip);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/tips/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const tip = await FarmerTip.findById(req.params.id);
    if (!tip) return res.status(404).json({ message: 'Tip not found' });

    if (req.file) {
      if (tip.cloudinaryId) await cloudinary.uploader.destroy(tip.cloudinaryId);
      tip.image = req.file.path;
      tip.cloudinaryId = req.file.filename;
    }

    tip.title = req.body.title || tip.title;
    tip.content = req.body.content || tip.content;
    tip.category = req.body.category || tip.category;
    tip.isActive = req.body.isActive !== undefined ? req.body.isActive === 'true' : tip.isActive;

    await tip.save();
    res.json(tip);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/tips/:id', auth, async (req, res) => {
  try {
    const tip = await FarmerTip.findById(req.params.id);
    if (!tip) return res.status(404).json({ message: 'Tip not found' });
    if (tip.cloudinaryId) await cloudinary.uploader.destroy(tip.cloudinaryId);
    await tip.deleteOne();
    res.json({ message: 'Tip deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
