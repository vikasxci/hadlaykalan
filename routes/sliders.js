const express = require('express');
const router = express.Router();
const Slider = require('../models/Slider');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// Get all active sliders
router.get('/', async (req, res) => {
  try {
    const sliders = await Slider.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
    res.json(sliders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all sliders (admin)
router.get('/all', auth, async (req, res) => {
  try {
    const sliders = await Slider.find().sort({ order: 1, createdAt: -1 });
    res.json(sliders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create slider
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const slider = new Slider({
      title: req.body.title,
      description: req.body.description,
      image: req.file.path,
      cloudinaryId: req.file.filename,
      link: req.body.link,
      type: req.body.type,
      order: req.body.order || 0
    });
    await slider.save();
    res.status(201).json(slider);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update slider
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const slider = await Slider.findById(req.params.id);
    if (!slider) return res.status(404).json({ message: 'Slider not found' });

    if (req.file) {
      if (slider.cloudinaryId) await cloudinary.uploader.destroy(slider.cloudinaryId);
      slider.image = req.file.path;
      slider.cloudinaryId = req.file.filename;
    }

    slider.title = req.body.title || slider.title;
    slider.description = req.body.description || slider.description;
    slider.link = req.body.link || slider.link;
    slider.type = req.body.type || slider.type;
    slider.isActive = req.body.isActive !== undefined ? req.body.isActive : slider.isActive;
    slider.order = req.body.order !== undefined ? req.body.order : slider.order;

    await slider.save();
    res.json(slider);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete slider
router.delete('/:id', auth, async (req, res) => {
  try {
    const slider = await Slider.findById(req.params.id);
    if (!slider) return res.status(404).json({ message: 'Slider not found' });
    if (slider.cloudinaryId) await cloudinary.uploader.destroy(slider.cloudinaryId);
    await slider.deleteOne();
    res.json({ message: 'Slider deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
