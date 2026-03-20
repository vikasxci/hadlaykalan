const express = require('express');
const router = express.Router();
const MarketPost = require('../models/MarketPost');
const workerAuth = require('../middleware/workerAuth');
const upload = require('../middleware/upload');

// ── GET all active market posts (public) ──────────────────────────
router.get('/posts', async (req, res) => {
  try {
    const { category, postType } = req.query;
    const filter = { status: 'active', isApproved: true };
    if (category && category !== 'all') filter.category = category;
    if (postType && postType !== 'all') filter.postType = postType;

    const posts = await MarketPost.find(filter)
      .populate('postedBy', 'name village photo areaLocation')
      .sort({ createdAt: -1 })
      .limit(60);

    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'मार्केट पोस्ट लोड नहीं हो सकी' });
  }
});

// ── GET my posts (auth) ───────────────────────────────────────────
router.get('/my-posts', workerAuth, async (req, res) => {
  try {
    const posts = await MarketPost.find({ postedBy: req.workerUser._id })
      .populate('postedBy', 'name village photo areaLocation')
      .populate('interestedBy.user', 'name phone whatsapp village photo areaLocation')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// ── POST create listing (auth, up to 4 images) ───────────────────
router.post('/posts', workerAuth, upload.array('images', 4), async (req, res) => {
  try {
    const { postType, category, title, description, price, priceType, quantity, location } = req.body;

    if (!postType || !category || !title) {
      return res.status(400).json({ message: 'पोस्ट प्रकार, श्रेणी और शीर्षक आवश्यक है' });
    }

    const images = (req.files || []).map(f => f.path || f.secure_url || '');

    const post = await MarketPost.create({
      postedBy: req.workerUser._id,
      postType,
      category,
      title: title.trim(),
      description: (description || '').trim(),
      price: price ? Number(price) : undefined,
      priceType: priceType || 'negotiable',
      quantity: (quantity || '').trim(),
      images,
      location: (location || '').trim()
    });

    const populated = await MarketPost.findById(post._id)
      .populate('postedBy', 'name village photo areaLocation');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Create market post error:', err);
    res.status(500).json({ message: 'पोस्ट बनाने में त्रुटि' });
  }
});

// ── POST show interest (auth) — shares both side numbers ─────────
router.post('/posts/:id/interest', workerAuth, async (req, res) => {
  try {
    const post = await MarketPost.findById(req.params.id)
      .populate('postedBy', 'name phone whatsapp village photo areaLocation');

    if (!post) return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    if (post.status !== 'active') return res.status(400).json({ message: 'यह पोस्ट अब उपलब्ध नहीं है' });

    if (post.postedBy._id.toString() === req.workerUser._id.toString()) {
      return res.status(400).json({ message: 'आप अपनी खुद की पोस्ट पर रुचि नहीं दिखा सकते' });
    }

    const alreadyInterested = post.interestedBy.some(
      i => i.user.toString() === req.workerUser._id.toString()
    );
    if (alreadyInterested) {
      // Already interested — just return contact info again
      return res.json({
        message: 'संपर्क जानकारी',
        contact: {
          name: post.postedBy.name,
          phone: post.postedBy.phone,
          whatsapp: post.postedBy.whatsapp,
          village: post.postedBy.village,
          areaLocation: post.postedBy.areaLocation,
          photo: post.postedBy.photo
        }
      });
    }

    post.interestedBy.push({ user: req.workerUser._id });
    await post.save();

    res.json({
      message: 'रुचि दर्ज की गई! अब आप विक्रेता से संपर्क कर सकते हैं।',
      contact: {
        name: post.postedBy.name,
        phone: post.postedBy.phone,
        whatsapp: post.postedBy.whatsapp,
        village: post.postedBy.village,
        areaLocation: post.postedBy.areaLocation,
        photo: post.postedBy.photo
      }
    });
  } catch (err) {
    console.error('Market interest error:', err);
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// ── PUT mark as sold / close (auth, only poster) ──────────────────
router.put('/posts/:id/close', workerAuth, async (req, res) => {
  try {
    const post = await MarketPost.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    if (post.postedBy.toString() !== req.workerUser._id.toString()) {
      return res.status(403).json({ message: 'सिर्फ पोस्ट करने वाला ही बंद कर सकता है' });
    }
    post.status = req.body.status === 'sold' ? 'sold' : 'closed';
    await post.save();
    res.json({ message: post.status === 'sold' ? 'बिक गया!' : 'पोस्ट बंद कर दी गई' });
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// ── DELETE post (auth, only poster) ──────────────────────────────
router.delete('/posts/:id', workerAuth, async (req, res) => {
  try {
    const post = await MarketPost.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    if (post.postedBy.toString() !== req.workerUser._id.toString()) {
      return res.status(403).json({ message: 'सिर्फ पोस्ट करने वाला ही हटा सकता है' });
    }
    await MarketPost.findByIdAndDelete(req.params.id);
    res.json({ message: 'पोस्ट हटा दी गई' });
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

module.exports = router;
