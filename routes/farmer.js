const express = require('express');
const router = express.Router();
const { MandiRate, FarmerTip, MandiCrop, MandiMarket } = require('../models/Farmer');
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

// ---- Mandi Crops (dropdown options) ----
router.get('/mandi-crops', async (req, res) => {
  try {
    const crops = await MandiCrop.find({ isActive: true }).sort({ name: 1 });
    res.json(crops);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/mandi-crops', auth, async (req, res) => {
  try {
    const { name, nameHi } = req.body;
    if (!name) return res.status(400).json({ message: 'Crop name is required' });
    const crop = new MandiCrop({ name: name.trim(), nameHi: nameHi ? nameHi.trim() : '' });
    await crop.save();
    res.status(201).json(crop);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Crop already exists' });
    res.status(500).json({ message: err.message });
  }
});

router.put('/mandi-crops/:id', auth, async (req, res) => {
  try {
    const { name, nameHi, isActive } = req.body;
    const crop = await MandiCrop.findById(req.params.id);
    if (!crop) return res.status(404).json({ message: 'Crop not found' });
    if (name) crop.name = name.trim();
    if (nameHi !== undefined) crop.nameHi = nameHi.trim();
    if (isActive !== undefined) crop.isActive = isActive;
    await crop.save();
    res.json(crop);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/mandi-crops/:id', auth, async (req, res) => {
  try {
    await MandiCrop.findByIdAndDelete(req.params.id);
    res.json({ message: 'Crop deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ---- Mandi Markets (dropdown options) ----
router.get('/mandi-markets', async (req, res) => {
  try {
    const markets = await MandiMarket.find({ isActive: true }).sort({ name: 1 });
    res.json(markets);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/mandi-markets', auth, async (req, res) => {
  try {
    const { name, location } = req.body;
    if (!name) return res.status(400).json({ message: 'Market name is required' });
    const market = new MandiMarket({ name: name.trim(), location: location ? location.trim() : '' });
    await market.save();
    res.status(201).json(market);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Market already exists' });
    res.status(500).json({ message: err.message });
  }
});

router.put('/mandi-markets/:id', auth, async (req, res) => {
  try {
    const { name, location, isActive } = req.body;
    const market = await MandiMarket.findById(req.params.id);
    if (!market) return res.status(404).json({ message: 'Market not found' });
    if (name) market.name = name.trim();
    if (location !== undefined) market.location = location.trim();
    if (isActive !== undefined) market.isActive = isActive;
    await market.save();
    res.json(market);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/mandi-markets/:id', auth, async (req, res) => {
  try {
    await MandiMarket.findByIdAndDelete(req.params.id);
    res.json({ message: 'Market deleted' });
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
