const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const HomeMedia = require('../models/HomeMedia');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const { extractVideoId } = require('../helpers/youtubeId');

// Only ever hand the frontend the fields it renders.
function publicShape(d) {
  return {
    _id: d._id,
    type: d.type,
    title: d.title,
    caption: d.caption,
    videoId: d.videoId,
    imageUrl: d.imageUrl,
    link: d.link,
    order: d.order
  };
}

// Drop an uploaded asset we've decided not to keep (validation failed, or the
// item is being deleted). Best-effort — a stranded Cloudinary file is not
// worth failing the request over.
function destroyAsset(id) {
  if (!id) return;
  Promise.resolve(cloudinary.uploader.destroy(id)).catch(() => {});
}

/* ── Public ──────────────────────────────────────────────── */

// GET /api/home-media — active items for the home slider
router.get('/', async (req, res) => {
  try {
    const items = await HomeMedia.find({ isActive: true })
      .sort({ order: 1, _id: 1 })
      .lean();
    res.json(items.map(publicShape));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ── Admin ───────────────────────────────────────────────── */

// GET /api/home-media/admin/all — everything, including switched-off items
router.get('/admin/all', auth, async (req, res) => {
  try {
    const items = await HomeMedia.find().sort({ order: 1, _id: 1 }).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/home-media — add a video or an image
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { type, title, caption, link, videoUrl } = req.body;

    if (type === 'youtube') {
      // An image file has no business here — don't leave it on Cloudinary.
      if (req.file) destroyAsset(req.file.filename);
      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        return res.status(400).json({ message: 'Could not read a YouTube video ID from that link' });
      }
      const item = await HomeMedia.create({
        type: 'youtube',
        videoId,
        title:   title   ? String(title).trim()   : undefined,
        caption: caption ? String(caption).trim() : undefined,
        order:   Number(req.body.order) || 0,
        isActive: req.body.isActive === undefined ? true : req.body.isActive !== 'false'
      });
      return res.status(201).json(item);
    }

    if (type === 'image') {
      if (!req.file) return res.status(400).json({ message: 'Image file required' });
      const item = await HomeMedia.create({
        type: 'image',
        imageUrl: req.file.path,
        cloudinaryId: req.file.filename,
        title:   title   ? String(title).trim()   : undefined,
        caption: caption ? String(caption).trim() : undefined,
        link:    link    ? String(link).trim()    : undefined,
        order:   Number(req.body.order) || 0,
        isActive: req.body.isActive === undefined ? true : req.body.isActive !== 'false'
      });
      return res.status(201).json(item);
    }

    if (req.file) destroyAsset(req.file.filename);
    res.status(400).json({ message: "type must be 'youtube' or 'image'" });
  } catch (err) {
    if (req.file) destroyAsset(req.file.filename);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/home-media/:id — edit; an uploaded image replaces the old one
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const item = await HomeMedia.findById(req.params.id);
    if (!item) {
      if (req.file) destroyAsset(req.file.filename);
      return res.status(404).json({ message: 'Item not found' });
    }

    const { title, caption, link, videoUrl, order, isActive } = req.body;

    if (title    !== undefined) item.title    = String(title).trim();
    if (caption  !== undefined) item.caption  = String(caption).trim();
    if (link     !== undefined) item.link     = String(link).trim();
    if (order    !== undefined) item.order    = Number(order) || 0;
    if (isActive !== undefined) item.isActive = isActive === true || isActive === 'true';

    if (item.type === 'youtube' && videoUrl !== undefined && String(videoUrl).trim()) {
      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        if (req.file) destroyAsset(req.file.filename);
        return res.status(400).json({ message: 'Could not read a YouTube video ID from that link' });
      }
      item.videoId = videoId;
    }

    if (item.type === 'image' && req.file) {
      const previous = item.cloudinaryId;
      item.imageUrl = req.file.path;
      item.cloudinaryId = req.file.filename;
      destroyAsset(previous);          // only after the new one is in hand
    } else if (req.file) {
      destroyAsset(req.file.filename); // uploaded against a video item
    }

    await item.save();
    res.json(item);
  } catch (err) {
    if (req.file) destroyAsset(req.file.filename);
    res.status(500).json({ message: err.message });
  }
});

// POST /api/home-media/admin/reorder — persist a drag-and-drop ordering
router.post('/admin/reorder', auth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids) return res.status(400).json({ message: 'ids array required' });

    await HomeMedia.bulkWrite(ids.map((id, i) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: i } } }
    })));
    res.json({ success: true, count: ids.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/home-media/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const item = await HomeMedia.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    destroyAsset(item.cloudinaryId);
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
