const express = require('express');
const router = express.Router();
const Notice = require('../models/Notice');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// Get all active notices
router.get('/', async (req, res) => {
  try {
    const notices = await Notice.find({ isActive: true }).sort({ isPinned: -1, createdAt: -1 });
    res.json(notices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single notice
router.get('/:id', async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: 'Notice not found' });
    res.json(notice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all notices (admin)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const notices = await Notice.find().sort({ createdAt: -1 });
    res.json(notices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create notice
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const noticeData = {
      title: req.body.title,
      content: req.body.content,
      category: req.body.category,
      postedBy: req.body.postedBy || 'Sarpanch',
      eventDate: req.body.eventDate,
      isPinned: req.body.isPinned === 'true'
    };
    if (req.file) {
      noticeData.image = req.file.path;
      noticeData.cloudinaryId = req.file.filename;
    }
    const notice = new Notice(noticeData);
    await notice.save();
    res.status(201).json(notice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update notice
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: 'Notice not found' });

    if (req.file) {
      if (notice.cloudinaryId) await cloudinary.uploader.destroy(notice.cloudinaryId);
      notice.image = req.file.path;
      notice.cloudinaryId = req.file.filename;
    }

    notice.title = req.body.title || notice.title;
    notice.content = req.body.content || notice.content;
    notice.category = req.body.category || notice.category;
    notice.postedBy = req.body.postedBy || notice.postedBy;
    notice.eventDate = req.body.eventDate || notice.eventDate;
    notice.isActive = req.body.isActive !== undefined ? req.body.isActive === 'true' : notice.isActive;
    notice.isPinned = req.body.isPinned !== undefined ? req.body.isPinned === 'true' : notice.isPinned;

    await notice.save();
    res.json(notice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete notice
router.delete('/:id', auth, async (req, res) => {
  try {
    const notice = await Notice.findById(req.params.id);
    if (!notice) return res.status(404).json({ message: 'Notice not found' });
    if (notice.cloudinaryId) await cloudinary.uploader.destroy(notice.cloudinaryId);
    await notice.deleteOne();
    res.json({ message: 'Notice deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
