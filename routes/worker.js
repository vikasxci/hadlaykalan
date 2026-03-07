const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const WorkerUser = require('../models/WorkerUser');
const WorkPost = require('../models/WorkPost');
const workerAuth = require('../middleware/workerAuth');
const upload = require('../middleware/upload');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ---- AUTHENTICATION ----

// Register / Send verification code
router.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const { name, phone, whatsapp, village, userType, areaLocation } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ message: 'नाम और फ़ोन नंबर आवश्यक है' });
    }

    if (!userType || !['worker', 'employer'].includes(userType)) {
      return res.status(400).json({ message: 'कृपया अपनी भूमिका चुनें' });
    }

    // Clean phone number
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({ message: 'कृपया सही फ़ोन नंबर दर्ज करें' });
    }

    // Handle photo upload
    let photoUrl = '';
    if (req.file) {
      photoUrl = req.file.path || req.file.secure_url || '';
    }

    // Generate 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    let user = await WorkerUser.findOne({ phone: cleanPhone });
    if (user) {
      user.name = name;
      user.whatsapp = whatsapp || cleanPhone;
      user.village = village || '';
      user.userType = userType;
      user.areaLocation = areaLocation || '';
      if (photoUrl) user.photo = photoUrl;
      user.verificationCode = code;
      user.codeExpiresAt = codeExpiresAt;
      await user.save();
    } else {
      user = await WorkerUser.create({
        name,
        phone: cleanPhone,
        whatsapp: whatsapp || cleanPhone,
        village: village || '',
        userType,
        areaLocation: areaLocation || '',
        photo: photoUrl,
        verificationCode: code,
        codeExpiresAt
      });
    }

    res.json({ 
      message: 'सत्यापन कोड जनरेट हो गया',
      code,
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

// Login
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

    const code = Math.floor(1000 + Math.random() * 9000).toString();
    user.verificationCode = code;
    user.codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.json({ 
      message: 'सत्यापन कोड जनरेट हो गया',
      code,
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

    user.isVerified = true;
    user.verificationCode = undefined;
    user.codeExpiresAt = undefined;

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
        village: user.village,
        userType: user.userType,
        photo: user.photo,
        areaLocation: user.areaLocation
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
      village: user.village,
      userType: user.userType,
      photo: user.photo,
      areaLocation: user.areaLocation
    });
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// ---- WORK POSTS ----

// Create a work post
router.post('/posts', workerAuth, async (req, res) => {
  try {
    const { workType, customWorkType, title, description, paymentType, amount, workersNeeded, startDate, duration, location, dailyRate, monthlyRate, yearlyRate } = req.body;

    const isWorker = req.workerUser.userType === 'worker';
    const postType = isWorker ? 'available_worker' : 'need_worker';

    if (!workType || !title) {
      return res.status(400).json({ message: 'कार्य प्रकार और शीर्षक आवश्यक है' });
    }

    // Employer must provide paymentType + amount; Worker must provide at least one rate
    if (!isWorker && (!paymentType || !amount)) {
      return res.status(400).json({ message: 'भुगतान प्रकार और राशि आवश्यक है' });
    }
    if (isWorker && !dailyRate && !monthlyRate && !yearlyRate) {
      return res.status(400).json({ message: 'कम से कम एक दर (दैनिक/मासिक/वार्षिक) आवश्यक है' });
    }

    const postData = {
      postedBy: req.workerUser._id,
      postType,
      workType,
      customWorkType: workType === 'other' ? customWorkType : undefined,
      title,
      description,
      location
    };

    if (isWorker) {
      // Worker post: rates
      if (dailyRate) postData.dailyRate = Number(dailyRate);
      if (monthlyRate) postData.monthlyRate = Number(monthlyRate);
      if (yearlyRate) postData.yearlyRate = Number(yearlyRate);
    } else {
      // Employer post: payment + workers needed + duration
      postData.paymentType = paymentType;
      postData.amount = Number(amount);
      postData.workersNeeded = Number(workersNeeded) || 1;
      postData.startDate = startDate ? new Date(startDate) : undefined;
      postData.duration = duration;
    }

    const post = await WorkPost.create(postData);

    const populated = await WorkPost.findById(post._id).populate('postedBy', 'name phone village userType photo areaLocation');
    res.status(201).json(populated);
  } catch (err) {
    console.error('Create work post error:', err);
    res.status(500).json({ message: 'पोस्ट बनाने में त्रुटि' });
  }
});

// Get all active work posts - filtered by viewer's userType
router.get('/posts', async (req, res) => {
  try {
    const { workType, paymentType, viewerType } = req.query;
    const filter = { status: 'active', isApproved: true };
    
    if (viewerType === 'worker') {
      filter.postType = 'need_worker';
    } else if (viewerType === 'employer') {
      filter.postType = 'available_worker';
    }
    
    if (workType && workType !== 'all') filter.workType = workType;
    if (paymentType && paymentType !== 'all') filter.paymentType = paymentType;

    const posts = await WorkPost.find(filter)
      .populate('postedBy', 'name village userType photo areaLocation')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(posts);
  } catch (err) {
    console.error('Get work posts error:', err);
    res.status(500).json({ message: 'पोस्ट लोड करने में त्रुटि' });
  }
});

// Get my posts
router.get('/my-posts', workerAuth, async (req, res) => {
  try {
    const posts = await WorkPost.find({ postedBy: req.workerUser._id })
      .populate('postedBy', 'name village userType photo areaLocation')
      .populate('acceptedBy.worker', 'name phone whatsapp village userType photo areaLocation')
      .populate('hiredBy.employer', 'name phone whatsapp village userType photo areaLocation')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Accept a work post (worker accepts employer's post)
router.post('/posts/:id/accept', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id).populate('postedBy', 'name phone whatsapp village userType photo areaLocation');
    if (!post) {
      return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'यह पोस्ट अब उपलब्ध नहीं है' });
    }

    if (post.postType !== 'need_worker') {
      return res.status(400).json({ message: 'इस पोस्ट को स्वीकार नहीं किया जा सकता' });
    }

    const alreadyAccepted = post.acceptedBy.some(
      a => a.worker.toString() === req.workerUser._id.toString()
    );
    if (alreadyAccepted) {
      return res.status(400).json({ message: 'आपने पहले से यह कार्य स्वीकार किया है' });
    }

    if (post.postedBy._id.toString() === req.workerUser._id.toString()) {
      return res.status(400).json({ message: 'आप अपनी खुद की पोस्ट स्वीकार नहीं कर सकते' });
    }

    post.acceptedBy.push({ worker: req.workerUser._id });
    await post.save();

    res.json({
      message: 'कार्य स्वीकार किया गया! अब आप संपर्क कर सकते हैं।',
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
    console.error('Accept work post error:', err);
    res.status(500).json({ message: 'सर्वर त्रुटि' });
  }
});

// Hire a worker (employer hires from worker's post)
router.post('/posts/:id/hire', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id).populate('postedBy', 'name phone whatsapp village userType photo areaLocation');
    if (!post) {
      return res.status(404).json({ message: 'पोस्ट नहीं मिली' });
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'यह पोस्ट अब उपलब्ध नहीं है' });
    }

    if (post.postType !== 'available_worker') {
      return res.status(400).json({ message: 'इस पोस्ट पर काम पर नहीं रख सकते' });
    }

    const alreadyHired = post.hiredBy.some(
      h => h.employer.toString() === req.workerUser._id.toString()
    );
    if (alreadyHired) {
      return res.status(400).json({ message: 'आपने पहले से इस व्यक्ति में रुचि दिखाई है' });
    }

    if (post.postedBy._id.toString() === req.workerUser._id.toString()) {
      return res.status(400).json({ message: 'आप अपनी खुद की पोस्ट पर रुचि नहीं दिखा सकते' });
    }

    post.hiredBy.push({ employer: req.workerUser._id });
    await post.save();

    res.json({
      message: 'रुचि दर्ज की गई! अब आप मज़दूर से संपर्क कर सकते हैं।',
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
    console.error('Hire worker error:', err);
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

// Check interaction status
router.get('/posts/:id/check-accept', workerAuth, async (req, res) => {
  try {
    const post = await WorkPost.findById(req.params.id).populate('postedBy', 'name phone whatsapp village userType photo areaLocation');
    if (!post) return res.status(404).json({ accepted: false, hired: false });

    const accepted = post.acceptedBy.some(
      a => a.worker.toString() === req.workerUser._id.toString()
    );

    const hired = post.hiredBy ? post.hiredBy.some(
      h => h.employer.toString() === req.workerUser._id.toString()
    ) : false;

    if (accepted || hired) {
      return res.json({
        accepted,
        hired,
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

    res.json({ accepted: false, hired: false });
  } catch (err) {
    res.status(500).json({ accepted: false, hired: false });
  }
});

module.exports = router;
