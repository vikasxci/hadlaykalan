const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const WorkerUser = require('../models/WorkerUser');
const WorkPost = require('../models/WorkPost');
const workerAuth = require('../middleware/workerAuth');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ---- AUTHENTICATION ----

// Register / Send verification code
router.post('/register', async (req, res) => {
  try {
    const { name, phone, whatsapp, village } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ message: 'नाम और फ़ोन नंबर आवश्यक है' });
    }

    // Clean phone number
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ message: 'कृपया सही फ़ोन नंबर दर्ज करें' });
    }

    // Generate 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry

    let user = await WorkerUser.findOne({ phone: cleanPhone });
    if (user) {
      // Update existing user details & code
      user.name = name;
      user.whatsapp = whatsapp || cleanPhone;
      user.village = village || '';
      user.verificationCode = code;
      user.codeExpiresAt = codeExpiresAt;
      await user.save();
    } else {
      // Create new user
      user = await WorkerUser.create({
        name,
        phone: cleanPhone,
        whatsapp: whatsapp || cleanPhone,
        village: village || '',
        verificationCode: code,
        codeExpiresAt
      });
    }

    res.json({ 
      message: 'सत्यापन कोड जनरेट हो गया',
      code, // We return the code since no SMS API
      userId: user._id
    });
  } catch (err) {
    console.error('Worker register error:', err);
    if (err.code === 11000) {
      return res.status(400).json({ message: 'यह नंबर पहले से रजिस्टर है। कृपया लॉगिन करें।' });
    }
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Login - Send verification code for existing user
router.post('/login', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ message: 'फ़ोन नंबर आवश्यक है' });
    }

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const user = await WorkerUser.findOne({ phone: cleanPhone });
    if (!user) {
      return res.status(404).json({ message: 'यह नंबर रजिस्टर नहीं है। कृपया पहले रजिस्टर करें।' });
    }

    // Generate 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    user.verificationCode = code;
    user.codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.json({ 
      message: 'सत्यापन कोड जनरेट हो गया',
      code, // Return code (no SMS)
      userId: user._id
    });
  } catch (err) {
    console.error('Worker login error:', err);
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Verify code & get token
router.post('/verify', async (req, res) => {
  try {
    const { userId, code } = req.body;
    if (!userId || !code) {
      return res.status(400).json({ message: 'यूज़र ID और कोड आवश्यक है' });
    }

    const user = await WorkerUser.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'उपयोगकर्ता नहीं मिला' });
    }

    if (user.verificationCode !== code) {
      return res.status(400).json({ message: 'गलत कोड। कृपया सही कोड दर्ज करें।' });
    }

    if (user.codeExpiresAt < new Date()) {
      return res.status(400).json({ message: 'कोड की समय सीमा समाप्त हो गई। कृपया फिर से कोड भेजें।' });
    }

    // Mark verified and generate long-lived token
    user.isVerified = true;
    user.verificationCode = undefined;
    user.codeExpiresAt = undefined;

    // Token with very long expiry (essentially unlimited)
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '365d' });
    user.token = token;
    await user.save();

    res.json({ 
      message: 'सफलतापूर्वक लॉगिन हो गया!',
      token,
      user: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        whatsapp: user.whatsapp,
        village: user.village
      }
    });
  } catch (err) {
    console.error('Worker verify error:', err);
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Get current user profile
router.get('/me', workerAuth, async (req, res) => {
  try {
    const user = req.workerUser;
    res.json({
      _id: user._id,
      name: user.name,
      phone: user.phone,
      whatsapp: user.whatsapp,
      village: user.village
    });
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// ---- WORK POSTS ----

// Create a work post (requires login)
router.post('/posts', workerAuth, async (req, res) => {
  try {
    const { workType, customWorkType, title, description, paymentType, amount, workersNeeded, startDate, duration, location } = req.body;

    if (!workType || !title || !paymentType || !amount) {
      return res.status(400).json({ message: 'कार्य प्रकार, शीर्षक, भुगतान प्रकार और राशि आवश्यक है' });
    }

    const post = await WorkPost.create({
      postedBy: req.workerUser._id,
      workType,
      customWorkType: workType === 'other' ? customWorkType : undefined,
      title,
      description,
      paymentType,
      amount: Number(amount),
      workersNeeded: Number(workersNeeded) || 1,
      startDate: startDate ? new Date(startDate) : undefined,
      duration,
      location
    });

    const populated = await WorkPost.findById(post._id).populate('postedBy', 'name phone village');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Create work post error:', err);
    res.status(500).json({ message: 'पोस्ट बनाने में त्रुटि' });
  }
});

// Get all active work posts (public)
router.get('/posts', async (req, res) => {
  try {
    const { workType, paymentType } = req.query;
    const filter = { status: 'active', isApproved: true };
    if (workType && workType !== 'all') filter.workType = workType;
    if (paymentType && paymentType !== 'all') filter.paymentType = paymentType;

    const posts = await WorkPost.find(filter)
      .populate('postedBy', 'name village')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(posts);
  } catch (err) {
    console.error('Get work posts error:', err);
    res.status(500).json({ message: 'पोस्ट लोड करने में त्रुटि' });
  }
});

// Get my posts (requires login)
router.get('/my-posts', workerAuth, async (req, res) => {
  try {
    const posts = await WorkPost.find({ postedBy: req.workerUser._id })
      .populate('postedBy', 'name village')
      .populate('acceptedBy.worker', 'name phone whatsapp village')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Accept a work post (worker clicks accept - requires login)
router.post('/posts/:id/accept', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id).populate('postedBy', 'name phone whatsapp village');
    if (!post) {
      return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'यह पोस्ट अब उपलब्ध नहीं है' });
    }

    // Check if already accepted 
    const alreadyAccepted = post.acceptedBy.some(
      a => a.worker.toString() === req.workerUser._id.toString()
    );
    if (alreadyAccepted) {
      return res.status(400).json({ message: 'आपने पहले से यह कार्य स्वीकार किया है' });
    }

    // Can't accept own post
    if (post.postedBy._id.toString() === req.workerUser._id.toString()) {
      return res.status(400).json({ message: 'आप अपनी खुद की पोस्ट स्वीकार नहीं कर सकते' });
    }

    post.acceptedBy.push({ worker: req.workerUser._id });
    await post.save();

    // Return poster's contact details
    res.json({
      message: 'कार्य स्वीकार किया गया! अब आप संपर्क कर सकते हैं।',
      contact: {
        name: post.postedBy.name,
        phone: post.postedBy.phone,
        whatsapp: post.postedBy.whatsapp,
        village: post.postedBy.village
      }
    });
  } catch (err) {
    console.error('Accept work post error:', err);
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Close a post (only by poster)
router.put('/posts/:id/close', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    if (post.postedBy.toString() !== req.workerUser._id.toString()) {
      return res.status(403).json({ message: 'सिर्फ पोस्ट करने वाला ही बंद कर सकता है' });
    }
    post.status = 'closed';
    await post.save();
    res.json({ message: 'पोस्ट बंद कर दी गई' });
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Check if user has accepted a post
router.get('/posts/:id/check-accept', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id).populate('postedBy', 'name phone whatsapp village');
    if (!post) return res.status(404).json({ accepted: false });

    const accepted = post.acceptedBy.some(
      a => a.worker.toString() === req.workerUser._id.toString()
    );

    if (accepted) {
      return res.json({
        accepted: true,
        contact: {
          name: post.postedBy.name,
          phone: post.postedBy.phone,
          whatsapp: post.postedBy.whatsapp,
          village: post.postedBy.village
        }
      });
    }

    res.json({ accepted: false });
  } catch (err) {
    res.status(500).json({ accepted: false });
  }
});

module.exports = router;
