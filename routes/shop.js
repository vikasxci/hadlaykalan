const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const ShopSeller  = require('../models/ShopSeller');
const ShopProduct = require('../models/ShopProduct');
const upload   = require('../middleware/upload');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ── Seller Auth Middleware ─────────────────────────────────────────
async function sellerAuth(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'लॉगिन आवश्यक है' });
  try {
    const { sellerId } = jwt.verify(token, JWT_SECRET);
    const seller = await ShopSeller.findById(sellerId);
    if (!seller || seller.token !== token) {
      return res.status(401).json({ message: 'सत्र समाप्त हो गया है' });
    }
    req.seller = seller;
    next();
  } catch {
    res.status(401).json({ message: 'अमान्य टोकन' });
  }
}

// ═════════════════════════ SELLER AUTH ══════════════════════════

// POST /api/shop/seller/register
router.post('/seller/register', upload.single('photo'), async (req, res) => {
  try {
    const { name, phone, email, shopName, shopDesc, address, category, password } = req.body;
    if (!name || !phone || !shopName || !password) {
      return res.status(400).json({ message: 'नाम, फ़ोन, दुकान का नाम और पासवर्ड आवश्यक है' });
    }
    const existing = await ShopSeller.findOne({ phone: phone.trim() });
    if (existing) return res.status(400).json({ message: 'यह फ़ोन नंबर पहले से रजिस्टर है' });

    const photo = req.file ? (req.file.path || req.file.secure_url || '') : '';
    const seller = await ShopSeller.create({
      name: name.trim(), phone: phone.trim(), email, shopName: shopName.trim(),
      shopDesc, address, category, photo, password
    });

    const token = jwt.sign({ sellerId: seller._id }, JWT_SECRET, { expiresIn: '30d' });
    seller.token = token;
    await seller.save();

    res.status(201).json({
      message: 'रजिस्ट्रेशन सफल',
      token,
      seller: { _id: seller._id, name: seller.name, shopName: seller.shopName, photo: seller.photo }
    });
  } catch (err) {
    console.error('Shop register error:', err);
    res.status(500).json({ message: 'रजिस्ट्रेशन में त्रुटि' });
  }
});

// POST /api/shop/seller/login
router.post('/seller/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ message: 'फ़ोन और पासवर्ड आवश्यक है' });

    const seller = await ShopSeller.findOne({ phone: phone.trim() });
    if (!seller) return res.status(401).json({ message: 'फ़ोन नंबर नहीं मिला' });
    if (!seller.isActive) return res.status(403).json({ message: 'खाता निष्क्रिय है' });

    const ok = await seller.comparePassword(password);
    if (!ok) return res.status(401).json({ message: 'गलत पासवर्ड' });

    const token = jwt.sign({ sellerId: seller._id }, JWT_SECRET, { expiresIn: '30d' });
    seller.token = token;
    await seller.save();

    res.json({
      token,
      seller: { _id: seller._id, name: seller.name, shopName: seller.shopName,
                phone: seller.phone, email: seller.email, address: seller.address,
                category: seller.category, photo: seller.photo, shopDesc: seller.shopDesc }
    });
  } catch (err) {
    res.status(500).json({ message: 'लॉगिन में त्रुटि' });
  }
});

// GET /api/shop/seller/me
router.get('/seller/me', sellerAuth, async (req, res) => {
  const s = req.seller;
  res.json({ _id: s._id, name: s.name, shopName: s.shopName, phone: s.phone,
             email: s.email, address: s.address, category: s.category,
             photo: s.photo, shopDesc: s.shopDesc });
});

// PUT /api/shop/seller/profile  — update profile
router.put('/seller/profile', sellerAuth, upload.single('photo'), async (req, res) => {
  try {
    const { name, shopName, shopDesc, address, category, email } = req.body;
    const s = req.seller;
    if (name)     s.name     = name.trim();
    if (shopName) s.shopName = shopName.trim();
    if (shopDesc !== undefined) s.shopDesc = shopDesc;
    if (address  !== undefined) s.address  = address;
    if (category !== undefined) s.category = category;
    if (email    !== undefined) s.email    = email;
    if (req.file) s.photo = req.file.path || req.file.secure_url || '';
    await s.save();
    res.json({ message: 'प्रोफाइल अपडेट हुई', seller: s });
  } catch (err) {
    res.status(500).json({ message: 'अपडेट में त्रुटि' });
  }
});

// GET /api/shop/seller/dashboard  — stats + products
router.get('/seller/dashboard', sellerAuth, async (req, res) => {
  try {
    const products = await ShopProduct.find({ seller: req.seller._id }).sort({ createdAt: -1 });
    const totalClicks = products.reduce((s, p) => s + p.totalClicks, 0);
    const totalViews  = products.reduce((s, p) => s + p.totalViews,  0);
    const activeProducts = products.filter(p => p.isActive).length;

    // Recent clicks (last 20 across all products)
    const recent = products.flatMap(p => p.clicks.map(c => ({
      productId: p._id, productTitle: p.title, ...c.toObject()
    }))).sort((a, b) => new Date(b.clickedAt) - new Date(a.clickedAt)).slice(0, 20);

    res.json({ totalClicks, totalViews, totalProducts: products.length, activeProducts, products, recentClicks: recent });
  } catch (err) {
    res.status(500).json({ message: 'डैशबोर्ड लोड में त्रुटि' });
  }
});

// ════════════════════════ PRODUCTS (Auth) ════════════════════════

// POST /api/shop/products  — create
router.post('/products', sellerAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { title, description, price, mrp, unit, category, stock } = req.body;
    if (!title || price === undefined) {
      return res.status(400).json({ message: 'शीर्षक और मूल्य आवश्यक है' });
    }
    const images = (req.files || []).map(f => f.path || f.secure_url || '');
    const product = await ShopProduct.create({
      seller: req.seller._id, title: title.trim(), description: (description||'').trim(),
      price: Number(price), mrp: mrp ? Number(mrp) : undefined,
      unit: (unit||'').trim(), category: category || 'other',
      stock: stock ? Number(stock) : 0, images
    });
    const pop = await ShopProduct.findById(product._id).populate('seller', 'name shopName phone address photo');
    res.status(201).json(pop);
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ message: 'उत्पाद बनाने में त्रुटि' });
  }
});

// PUT /api/shop/products/:id  — update
router.put('/products/:id', sellerAuth, upload.array('images', 5), async (req, res) => {
  try {
    const product = await ShopProduct.findOne({ _id: req.params.id, seller: req.seller._id });
    if (!product) return res.status(404).json({ message: 'उत्पाद नहीं मिला' });

    const { title, description, price, mrp, unit, category, stock, isActive, keepImages } = req.body;
    if (title)       product.title       = title.trim();
    if (description !== undefined) product.description = description.trim();
    if (price !== undefined) product.price = Number(price);
    if (mrp   !== undefined) product.mrp   = mrp ? Number(mrp) : undefined;
    if (unit  !== undefined) product.unit  = unit.trim();
    if (category)    product.category    = category;
    if (stock !== undefined) product.stock = Number(stock);
    if (isActive !== undefined) product.isActive = isActive === 'true' || isActive === true;

    // Handle images: keep existing + add new
    const newImages = (req.files || []).map(f => f.path || f.secure_url || '');
    if (newImages.length > 0) {
      const keep = keepImages ? (Array.isArray(keepImages) ? keepImages : [keepImages]) : product.images;
      product.images = [...keep, ...newImages].slice(0, 5);
    }

    await product.save();
    const pop = await ShopProduct.findById(product._id).populate('seller', 'name shopName phone address photo');
    res.json(pop);
  } catch (err) {
    res.status(500).json({ message: 'अपडेट में त्रुटि' });
  }
});

// DELETE /api/shop/products/:id
router.delete('/products/:id', sellerAuth, async (req, res) => {
  try {
    const product = await ShopProduct.findOneAndDelete({ _id: req.params.id, seller: req.seller._id });
    if (!product) return res.status(404).json({ message: 'उत्पाद नहीं मिला' });
    res.json({ message: 'उत्पाद हटाया गया' });
  } catch (err) {
    res.status(500).json({ message: 'हटाने में त्रुटि' });
  }
});

// ════════════════════════ PUBLIC ROUTES ══════════════════════════

// GET /api/shop/products  — all active products (marketplace)
router.get('/products', async (req, res) => {
  try {
    const { category, search, limit = 40 } = req.query;
    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    if (search) filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
    const products = await ShopProduct.find(filter)
      .populate('seller', 'name shopName phone address photo')
      .sort({ createdAt: -1 })
      .limit(Number(limit));
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'उत्पाद लोड में त्रुटि' });
  }
});

// GET /api/shop/products/random  — random products for ads
router.get('/products/random', async (req, res) => {
  try {
    const count = await ShopProduct.countDocuments({ isActive: true });
    if (count === 0) return res.json([]);
    const take = Math.min(5, count);
    const skip = Math.floor(Math.random() * Math.max(1, count - take));
    const products = await ShopProduct.find({ isActive: true })
      .populate('seller', 'name shopName phone address photo')
      .skip(skip)
      .limit(take);
    // Shuffle
    products.sort(() => Math.random() - 0.5);
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'विज्ञापन लोड में त्रुटि' });
  }
});

// GET /api/shop/products/:id  — single product detail
router.get('/products/:id', async (req, res) => {
  try {
    const product = await ShopProduct.findById(req.params.id)
      .populate('seller', 'name shopName phone email address photo shopDesc');
    if (!product) return res.status(404).json({ message: 'उत्पाद नहीं मिला' });
    // Increment view
    product.totalViews += 1;
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'उत्पाद लोड में त्रुटि' });
  }
});

// POST /api/shop/products/:id/click  — record ad click + notify via WebSocket
router.post('/products/:id/click', async (req, res) => {
  try {
    const { page, userAgent } = req.body;
    const product = await ShopProduct.findById(req.params.id).populate('seller');
    if (!product) return res.status(404).json({ message: 'उत्पाद नहीं मिला' });

    product.totalClicks += 1;
    product.clicks.push({ clickedAt: new Date(), userAgent: userAgent || '', page: page || '/' });
    // Keep only last 500 clicks to avoid bloat
    if (product.clicks.length > 500) product.clicks = product.clicks.slice(-500);
    await product.save();

    // Notify seller via WebSocket (global wss attached to app)
    const wss = req.app.get('wss');
    if (wss) {
      const payload = JSON.stringify({
        type: 'PRODUCT_CLICK',
        productId: product._id,
        productTitle: product.title,
        sellerId: product.seller._id,
        page: page || '/',
        clickedAt: new Date().toISOString()
      });
      wss.clients.forEach(client => {
        if (client.readyState === 1 && client.sellerId === String(product.seller._id)) {
          client.send(payload);
        }
      });
    }

    res.json({ message: 'क्लिक दर्ज' });
  } catch (err) {
    res.status(500).json({ message: 'क्लिक दर्ज में त्रुटि' });
  }
});

module.exports = router;
module.exports.sellerAuth = sellerAuth;
