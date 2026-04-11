const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');
const mongoose = require('mongoose');
const upload   = require('../middleware/upload');
const inventoryAuth = require('../middleware/inventoryAuth');

const InventoryBusiness         = require('../models/InventoryBusiness');
const InventoryCategory         = require('../models/InventoryCategory');
const InventorySupplier         = require('../models/InventorySupplier');
const InventoryItem             = require('../models/InventoryItem');
const InventoryStockTransaction = require('../models/InventoryStockTransaction');
const InventoryActivityLog      = require('../models/InventoryActivityLog');
const InventoryCustomer         = require('../models/InventoryCustomer');
const InventoryInvoice          = require('../models/InventoryInvoice');
const adminAuth                 = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ─── Activity Logger ────────────────────────────────────────────────────────
async function logActivity(req, business, action, extras = {}) {
  try {
    await InventoryActivityLog.create({
      business:     business._id,
      businessName: business.businessName,
      ownerEmail:   business.email,
      action,
      entity:     extras.entity     || null,
      entityId:   extras.entityId   || null,
      entityName: extras.entityName || null,
      details:    extras.details    || null,
      ip:         req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '',
      userAgent:  req.headers['user-agent'] || '',
    });
  } catch (e) { /* non-critical, never throw */ }
}

// ─── Utility ────────────────────────────────────────────────────────────────
function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

function makeToken(businessId) {
  return jwt.sign({ businessId }, JWT_SECRET, { expiresIn: '30d' });
}

// ═══════════════════════════ AUTH ═══════════════════════════════════════════

// POST /api/inventory/register
router.post('/register', upload.single('logo'), async (req, res) => {
  try {
    const {
      ownerName, businessName, email, phone, password,
      businessType, description, gstin, pan, licenseNo,
      street, city, state, pincode, country,
      currency, lowStockThreshold, defaultTaxRate, registrationSource
    } = req.body;

    if (!ownerName || !businessName || !email || !phone || !password) {
      return res.status(400).json({ message: 'Owner name, business name, email, phone and password are required.' });
    }

    const existing = await InventoryBusiness.findOne({ $or: [{ email: email.toLowerCase() }, { phone: phone.trim() }] });
    if (existing) {
      return res.status(400).json({ message: 'An account with this email or phone already exists.' });
    }

    // Generate unique slug
    let baseSlug = slugify(businessName);
    let slug = baseSlug;
    let counter = 1;
    while (await InventoryBusiness.findOne({ slug })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const logo = req.file ? (req.file.path || req.file.secure_url || '') : '';

    const business = await InventoryBusiness.create({
      ownerName: ownerName.trim(),
      businessName: businessName.trim(),
      slug,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      businessType: businessType || 'retail',
      description,
      logo,
      gstin, pan, licenseNo,
      address: { street, city, state, pincode, country: country || 'India' },
      currency: currency || 'INR',
      currencySymbol: currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹',
      lowStockThreshold: Number(lowStockThreshold) || 5,
      defaultTaxRate: Number(defaultTaxRate) || 18,
      registrationSource: registrationSource || 'web'
    });

    const token = makeToken(business._id);
    business.token = token;
    await business.save();

    logActivity(req, business, 'register', { details: { businessType: business.businessType, city: business.address?.city } });

    res.status(201).json({
      message: 'Business registered successfully.',
      token,
      business: { _id: business._id, ownerName: business.ownerName, businessName: business.businessName, slug: business.slug, logo: business.logo }
    });
  } catch (err) {
    console.error('Inventory register error:', err);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// POST /api/inventory/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });

    const business = await InventoryBusiness.findOne({ email: email.toLowerCase().trim() });
    if (!business) return res.status(401).json({ message: 'Invalid email or password.' });
    if (!business.isActive) return res.status(403).json({ message: 'Account is inactive.' });

    const ok = await business.comparePassword(password);
    if (!ok) return res.status(401).json({ message: 'Invalid email or password.' });

    const token = makeToken(business._id);
    business.token = token;
    business.lastLoginAt = new Date();
    business.loginCount  = (business.loginCount || 0) + 1;
    await business.save();

    logActivity(req, business, 'login', { details: { loginCount: business.loginCount } });

    res.json({
      token,
      business: {
        _id: business._id, ownerName: business.ownerName,
        businessName: business.businessName, slug: business.slug,
        logo: business.logo, currency: business.currency,
        currencySymbol: business.currencySymbol,
        lowStockThreshold: business.lowStockThreshold
      }
    });
  } catch (err) {
    console.error('Inventory login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// GET /api/inventory/me  (verify session)
router.get('/me', inventoryAuth, (req, res) => {
  res.json({ business: req.business });
});

// POST /api/inventory/logout
router.post('/logout', inventoryAuth, async (req, res) => {
  try {
    logActivity(req, req.business, 'logout');
    req.business.token = null;
    await req.business.save();
    res.json({ message: 'Logged out.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/inventory/slug/:slug  (check slug availability / public profile)
router.get('/slug/:slug', async (req, res) => {
  const business = await InventoryBusiness.findOne({ slug: req.params.slug }).select('-password -token');
  if (!business) return res.status(404).json({ message: 'Business not found.' });
  res.json({ business });
});

// ═══════════════════════════ BUSINESS PROFILE ════════════════════════════════

// PUT /api/inventory/profile
router.put('/profile', inventoryAuth, upload.single('logo'), async (req, res) => {
  try {
    const {
      ownerName, businessName, description, businessType,
      street, city, state, pincode, country,
      gstin, pan, licenseNo, phone, website,
      currency, lowStockThreshold, defaultTaxRate, defaultTaxType,
      fiscalYearStart
    } = req.body;

    const business = req.business;

    if (ownerName)    business.ownerName    = ownerName.trim();
    if (businessName) business.businessName = businessName.trim();
    if (description)  business.description  = description;
    if (businessType) business.businessType = businessType;
    if (phone)        business.phone        = phone.trim();
    if (website)      business.website      = website.trim();
    if (gstin)        business.gstin        = gstin.trim();
    if (pan)          business.pan          = pan.trim();
    if (licenseNo)    business.licenseNo    = licenseNo.trim();
    if (fiscalYearStart) business.fiscalYearStart = fiscalYearStart;

    if (street || city || state || pincode || country) {
      business.address = {
        street:  street  || business.address?.street,
        city:    city    || business.address?.city,
        state:   state   || business.address?.state,
        pincode: pincode || business.address?.pincode,
        country: country || business.address?.country || 'India'
      };
    }

    if (currency) {
      business.currency       = currency;
      business.currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '₹';
    }
    if (lowStockThreshold !== undefined) business.lowStockThreshold = Number(lowStockThreshold);
    if (defaultTaxRate    !== undefined) business.defaultTaxRate    = Number(defaultTaxRate);
    if (defaultTaxType)   business.defaultTaxType = defaultTaxType;

    if (req.file) business.logo = req.file.path || req.file.secure_url || '';

    await business.save();
    res.json({ message: 'Profile updated.', business });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ DASHBOARD ══════════════════════════════════════

// GET /api/inventory/dashboard
router.get('/dashboard', inventoryAuth, async (req, res) => {
  try {
    const bId = req.business._id;

    const [
      totalItems,
      lowStockItems,
      outOfStockItems,
      totalCategories,
      totalSuppliers,
      recentTransactions
    ] = await Promise.all([
      InventoryItem.countDocuments({ business: bId, isActive: true }),
      InventoryItem.countDocuments({ business: bId, isActive: true, $expr: { $and: [{ $gt: ['$currentStock', 0] }, { $lte: ['$currentStock', '$minStock'] }] } }),
      InventoryItem.countDocuments({ business: bId, isActive: true, currentStock: { $lte: 0 }, isService: false }),
      InventoryCategory.countDocuments({ business: bId, isActive: true }),
      InventorySupplier.countDocuments({ business: bId, isActive: true }),
      InventoryStockTransaction.find({ business: bId }).sort({ createdAt: -1 }).limit(10)
        .populate('item', 'name sku unit').lean()
    ]);

    // Total inventory value (cost)
    const valueAgg = await InventoryItem.aggregate([
      { $match: { business: bId, isActive: true } },
      { $group: { _id: null, totalCostValue: { $sum: { $multiply: ['$currentStock', '$costPrice'] } }, totalSellValue: { $sum: { $multiply: ['$currentStock', '$sellingPrice'] } } } }
    ]);
    const { totalCostValue = 0, totalSellValue = 0 } = valueAgg[0] || {};

    // Top 5 low stock items
    const lowStockList = await InventoryItem.find({
      business: bId, isActive: true, isService: false,
      $expr: { $lte: ['$currentStock', '$minStock'] }
    }).sort({ currentStock: 1 }).limit(5).populate('category', 'name').lean();

    // Last 30-day sales summary
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const salesAgg = await InventoryStockTransaction.aggregate([
      { $match: { business: bId, type: 'sale', createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, totalQty: { $sum: '$quantity' }, totalRevenue: { $sum: '$totalAmount' }, count: { $sum: 1 } } }
    ]);
    const { totalQty: soldQty30 = 0, totalRevenue: revenue30 = 0, count: salesCount30 = 0 } = salesAgg[0] || {};

    // Category distribution
    const categoryDist = await InventoryItem.aggregate([
      { $match: { business: bId, isActive: true } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $lookup: { from: 'inventorycategories', localField: '_id', foreignField: '_id', as: 'cat' } },
      { $project: { name: { $ifNull: [{ $arrayElemAt: ['$cat.name', 0] }, 'Uncategorized'] }, count: 1 } },
      { $sort: { count: -1 } }, { $limit: 8 }
    ]);

    res.json({
      stats: { totalItems, lowStockItems, outOfStockItems, totalCategories, totalSuppliers, totalCostValue, totalSellValue, potentialProfit: totalSellValue - totalCostValue },
      sales30: { soldQty30, revenue30, salesCount30 },
      recentTransactions,
      lowStockList,
      categoryDist
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ CATEGORIES ═════════════════════════════════════

// GET /api/inventory/categories
router.get('/categories', inventoryAuth, async (req, res) => {
  const categories = await InventoryCategory.find({ business: req.business._id }).sort({ sortOrder: 1, name: 1 }).lean();
  res.json(categories);
});

// POST /api/inventory/categories
router.post('/categories', inventoryAuth, async (req, res) => {
  try {
    const { name, description, parentCategory, icon, color, sortOrder } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required.' });

    const cat = await InventoryCategory.create({
      business: req.business._id, name: name.trim(), description, parentCategory: parentCategory || null,
      icon, color: color || '#6366f1', sortOrder: Number(sortOrder) || 0
    });
    logActivity(req, req.business, 'category_create', { entity: 'category', entityId: cat._id, entityName: cat.name });
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/inventory/categories/:id
router.put('/categories/:id', inventoryAuth, async (req, res) => {
  try {
    const cat = await InventoryCategory.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!cat) return res.status(404).json({ message: 'Category not found.' });
    logActivity(req, req.business, 'category_update', { entity: 'category', entityId: cat._id, entityName: cat.name });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/inventory/categories/:id
router.delete('/categories/:id', inventoryAuth, async (req, res) => {
  try {
    const inUse = await InventoryItem.countDocuments({ business: req.business._id, category: req.params.id });
    if (inUse > 0) return res.status(400).json({ message: `Cannot delete: ${inUse} item(s) are using this category.` });
    await InventoryCategory.findOneAndDelete({ _id: req.params.id, business: req.business._id });
    logActivity(req, req.business, 'category_delete', { entity: 'category', entityId: req.params.id, details: { id: req.params.id } });
    res.json({ message: 'Category deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ SUPPLIERS ══════════════════════════════════════

// GET /api/inventory/suppliers
router.get('/suppliers', inventoryAuth, async (req, res) => {
  const { search, page = 1, limit = 50 } = req.query;
  const query = { business: req.business._id };
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { companyName: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];

  const suppliers = await InventorySupplier.find(query).sort({ name: 1 })
    .skip((page - 1) * limit).limit(Number(limit)).lean();
  const total = await InventorySupplier.countDocuments(query);
  res.json({ suppliers, total, page: Number(page) });
});

// POST /api/inventory/suppliers
router.post('/suppliers', inventoryAuth, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'Supplier name and phone are required.' });

    const supplier = await InventorySupplier.create({ ...req.body, business: req.business._id, name: name.trim(), phone: phone.trim() });
    logActivity(req, req.business, 'supplier_create', { entity: 'supplier', entityId: supplier._id, entityName: supplier.name });
    res.status(201).json(supplier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/inventory/suppliers/:id
router.put('/suppliers/:id', inventoryAuth, async (req, res) => {
  try {
    const supplier = await InventorySupplier.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { $set: req.body }, { new: true, runValidators: true }
    );
    if (!supplier) return res.status(404).json({ message: 'Supplier not found.' });
    logActivity(req, req.business, 'supplier_update', { entity: 'supplier', entityId: supplier._id, entityName: supplier.name });
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/inventory/suppliers/:id
router.delete('/suppliers/:id', inventoryAuth, async (req, res) => {
  try {
    await InventorySupplier.findOneAndDelete({ _id: req.params.id, business: req.business._id });
    logActivity(req, req.business, 'supplier_delete', { entity: 'supplier', entityId: req.params.id, details: { id: req.params.id } });
    res.json({ message: 'Supplier deleted.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ ITEMS ══════════════════════════════════════════

// GET /api/inventory/items
router.get('/items', inventoryAuth, async (req, res) => {
  try {
    const { search, category, status, lowStock, page = 1, limit = 30, sort = '-createdAt' } = req.query;
    const query = { business: req.business._id };

    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { sku: new RegExp(search, 'i') },
        { barcode: new RegExp(search, 'i') },
        { brand: new RegExp(search, 'i') },
        { tags: new RegExp(search, 'i') }
      ];
    }
    if (category && mongoose.Types.ObjectId.isValid(category)) query.category = category;
    if (status === 'active')   query.isActive = true;
    if (status === 'inactive') query.isActive = false;
    if (lowStock === 'true')   query.$expr = { $lte: ['$currentStock', '$minStock'] };

    const [items, total] = await Promise.all([
      InventoryItem.find(query)
        .populate('category', 'name color icon')
        .populate('preferredSupplier', 'name phone')
        .sort(sort)
        .skip((+page - 1) * +limit)
        .limit(+limit)
        .lean(),
      InventoryItem.countDocuments(query)
    ]);

    res.json({ items, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err) {
    console.error('Items list error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/inventory/items/:id
router.get('/items/:id', inventoryAuth, async (req, res) => {
  const item = await InventoryItem.findOne({ _id: req.params.id, business: req.business._id })
    .populate('category', 'name color icon')
    .populate('preferredSupplier', 'name phone company')
    .lean();
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  res.json(item);
});

// POST /api/inventory/items
router.post('/items', inventoryAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { name, sellingPrice } = req.body;
    if (!name) return res.status(400).json({ message: 'Item name is required.' });

    const images = req.files ? req.files.map(f => f.path || f.secure_url || '') : [];

    // Parse nested fields that may come as JSON strings
    let dimensions = req.body.dimensions;
    if (typeof dimensions === 'string') { try { dimensions = JSON.parse(dimensions); } catch { dimensions = {}; } }

    const itemData = {
      ...req.body,
      business: req.business._id,
      images,
      dimensions,
      tags: req.body.tags ? (Array.isArray(req.body.tags) ? req.body.tags : req.body.tags.split(',').map(t => t.trim())) : [],
      costPrice:       Number(req.body.costPrice)       || 0,
      sellingPrice:    Number(req.body.sellingPrice)    || 0,
      mrp:             req.body.mrp ? Number(req.body.mrp) : undefined,
      currentStock:    Number(req.body.currentStock)    || 0,
      openingStock:    Number(req.body.currentStock)    || 0,
      minStock:        Number(req.body.minStock)        || 0,
      maxStock:        req.body.maxStock ? Number(req.body.maxStock) : undefined,
      reorderPoint:    Number(req.body.reorderPoint)    || 0,
      reorderQty:      Number(req.body.reorderQty)      || 0,
      taxRate:         Number(req.body.taxRate)         || 0,
      discountPercent: Number(req.body.discountPercent) || 0,
      leadTimeDays:    Number(req.body.leadTimeDays)    || 0,
      weight:          req.body.weight ? Number(req.body.weight) : undefined
    };

    // Compute gross margin
    if (itemData.costPrice > 0) {
      itemData.grossMarginPercent = ((itemData.sellingPrice - itemData.costPrice) / itemData.costPrice * 100).toFixed(2);
    }

    const item = await InventoryItem.create(itemData);
    logActivity(req, req.business, 'item_create', { entity: 'item', entityId: item._id, entityName: item.name, details: { sku: item.sku, stock: item.currentStock } });

    // Create opening stock transaction if stock > 0
    if (item.currentStock > 0) {
      await InventoryStockTransaction.create({
        business: req.business._id, item: item._id, type: 'opening',
        quantity: item.currentStock, quantityBefore: 0, quantityAfter: item.currentStock,
        unit: item.unit, unitPrice: item.costPrice,
        totalAmount: item.currentStock * item.costPrice,
        createdBy: req.business.ownerName, notes: 'Opening stock entry'
      });
    }

    res.status(201).json(item);
  } catch (err) {
    console.error('Item create error:', err);
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/inventory/items/:id
router.put('/items/:id', inventoryAuth, upload.array('images', 5), async (req, res) => {
  try {
    const item = await InventoryItem.findOne({ _id: req.params.id, business: req.business._id });
    if (!item) return res.status(404).json({ message: 'Item not found.' });

    const updates = { ...req.body };

    // Handle new images appended
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(f => f.path || f.secure_url || '');
      updates.images = [...(item.images || []), ...newImages];
    }

    if (updates.tags && !Array.isArray(updates.tags)) {
      updates.tags = updates.tags.split(',').map(t => t.trim());
    }
    ['costPrice', 'sellingPrice', 'mrp', 'currentStock', 'minStock', 'maxStock', 'reorderPoint', 'reorderQty', 'taxRate', 'discountPercent', 'leadTimeDays', 'weight'].forEach(f => {
      if (updates[f] !== undefined) updates[f] = Number(updates[f]);
    });

    if (updates.costPrice > 0) {
      updates.grossMarginPercent = ((updates.sellingPrice - updates.costPrice) / updates.costPrice * 100).toFixed(2);
    }
    updates.lastStockUpdateAt = new Date();

    Object.assign(item, updates);
    await item.save();
    logActivity(req, req.business, 'item_update', { entity: 'item', entityId: item._id, entityName: item.name });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/inventory/items/:id  (soft delete)
router.delete('/items/:id', inventoryAuth, async (req, res) => {
  try {
    const item = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { isActive: false }, { new: true }
    );
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    logActivity(req, req.business, 'item_delete', { entity: 'item', entityId: item._id, entityName: item.name });
    res.json({ message: 'Item deactivated.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/inventory/items/:id/image  (remove image by index)
router.delete('/items/:id/image', inventoryAuth, async (req, res) => {
  try {
    const { index } = req.body;
    const item = await InventoryItem.findOne({ _id: req.params.id, business: req.business._id });
    if (!item) return res.status(404).json({ message: 'Item not found.' });
    item.images.splice(Number(index), 1);
    await item.save();
    res.json({ images: item.images });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ STOCK TRANSACTIONS ══════════════════════════════

// GET /api/inventory/transactions
router.get('/transactions', inventoryAuth, async (req, res) => {
  try {
    const { itemId, type, page = 1, limit = 30, from, to } = req.query;
    const query = { business: req.business._id };
    if (itemId) query.item = itemId;
    if (type)   query.type = type;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to)   query.createdAt.$lte = new Date(to);
    }

    const [txns, total] = await Promise.all([
      InventoryStockTransaction.find(query)
        .populate('item', 'name sku unit images')
        .populate('supplier', 'name')
        .sort({ createdAt: -1 })
        .skip((+page - 1) * +limit)
        .limit(+limit)
        .lean(),
      InventoryStockTransaction.countDocuments(query)
    ]);

    res.json({ transactions: txns, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/inventory/transactions  (stock in / out / adjust)
router.post('/transactions', inventoryAuth, async (req, res) => {
  try {
    const {
      itemId, type, quantity, unitPrice = 0, discount = 0, taxAmount = 0,
      batchNo, lotNo, serialNo, manufactureDate, expiryDate, referenceNo,
      supplier, supplierName, customerName, customerPhone, customerEmail, notes
    } = req.body;

    if (!itemId || !type || !quantity) {
      return res.status(400).json({ message: 'Item, type and quantity are required.' });
    }

    const item = await InventoryItem.findOne({ _id: itemId, business: req.business._id });
    if (!item) return res.status(404).json({ message: 'Item not found.' });

    const qty = Math.abs(Number(quantity));
    const isIn = ['purchase', 'adjustment_in', 'return_in', 'transfer_in', 'opening'].includes(type);
    const isOut = ['sale', 'adjustment_out', 'return_out', 'transfer_out', 'damage', 'expired'].includes(type);

    if (isOut && !item.allowNegativeStock && item.currentStock < qty) {
      return res.status(400).json({ message: `Insufficient stock. Available: ${item.currentStock} ${item.unit}` });
    }

    const before = item.currentStock;
    const after  = isIn ? before + qty : before - qty;

    const totalAmount = (Number(unitPrice) * qty) - Number(discount) + Number(taxAmount);

    const txn = await InventoryStockTransaction.create({
      business: req.business._id, item: itemId, type, quantity: qty,
      quantityBefore: before, quantityAfter: after, unit: item.unit,
      unitPrice: Number(unitPrice), discount: Number(discount),
      taxAmount: Number(taxAmount), totalAmount,
      batchNo, lotNo, serialNo,
      manufactureDate: manufactureDate ? new Date(manufactureDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      referenceNo, supplier, supplierName, customerName, customerPhone, customerEmail,
      notes, createdBy: req.business.ownerName
    });

    // Update item stock and analytics
    item.currentStock = after;
    item.lastStockUpdateAt = new Date();

    if (isIn) {
      item.totalPurchased = (item.totalPurchased || 0) + qty;
      item.totalCost      = (item.totalCost || 0) + (Number(unitPrice) * qty);
      item.lastPurchasedAt = new Date();
      if (type === 'purchase') item.lastRestockedAt = new Date();
    }
    if (type === 'sale') {
      item.totalSold    = (item.totalSold    || 0) + qty;
      item.totalRevenue = (item.totalRevenue || 0) + totalAmount;
      item.lastSoldAt   = new Date();
    }

    await item.save();

    // ─── Update customer aggregate stats if this is a sale ────────────────────
    if (type === 'sale' && (customerName || customerPhone)) {
      // Try to find customer by phone or create reference
      let cust = null;
      if (customerPhone) {
        cust = await InventoryCustomer.findOne({ business: req.business._id, phone: customerPhone.trim() });
      }
      // If not found by phone, look for by name (less reliable but fallback)
      if (!cust && customerName) {
        cust = await InventoryCustomer.findOne({ business: req.business._id, name: new RegExp(`^${customerName}$`, 'i') });
      }
      // If found, update aggregate stats
      if (cust) {
        await InventoryCustomer.updateOne(
          { _id: cust._id },
          {
            $inc: { totalAmount: totalAmount },
            $set: { lastPurchaseAt: new Date() }
          }
        );
      }
      // Note: If customer is not found, we don't auto-create here. The frontend can optionally
      // create the customer record separately with the "Add New" checkbox.
    }

    await txn.populate('item', 'name sku unit');
    logActivity(req, req.business, 'transaction_create', { entity: 'transaction', entityId: txn._id, entityName: item.name, details: { type, qty, unitPrice: Number(unitPrice), totalAmount, customerName } });
    res.status(201).json(txn);
  } catch (err) {
    console.error('Transaction error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ REPORTS ════════════════════════════════════════

// GET /api/inventory/reports/overview
router.get('/reports/overview', inventoryAuth, async (req, res) => {
  try {
    const bId = req.business._id;
    const { days = 30 } = req.query;
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

    // Daily sales trend
    const dailySales = await InventoryStockTransaction.aggregate([
      { $match: { business: bId, type: 'sale', createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, qty: { $sum: '$quantity' }, revenue: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    // Top selling items
    const topItems = await InventoryStockTransaction.aggregate([
      { $match: { business: bId, type: 'sale', createdAt: { $gte: since } } },
      { $group: { _id: '$item', totalQty: { $sum: '$quantity' }, totalRevenue: { $sum: '$totalAmount' } } },
      { $sort: { totalQty: -1 } }, { $limit: 10 },
      { $lookup: { from: 'inventoryitems', localField: '_id', foreignField: '_id', as: 'item' } },
      { $project: { name: { $arrayElemAt: ['$item.name', 0] }, sku: { $arrayElemAt: ['$item.sku', 0] }, totalQty: 1, totalRevenue: 1 } }
    ]);

    // Transaction type breakdown
    const typeBreakdown = await InventoryStockTransaction.aggregate([
      { $match: { business: bId, createdAt: { $gte: since } } },
      { $group: { _id: '$type', count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } }
    ]);

    res.json({ dailySales, topItems, typeBreakdown });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ ADMIN MONITORING (Main Admin Panel) ═════════════
// All routes below are protected by adminAuth (the Hadlay Kalan main admin JWT)

// GET /api/inventory/admin/monitor  — overall summary for all businesses
router.get('/admin/monitor', adminAuth, async (req, res) => {
  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000);

    const [
      totalBusinesses,
      activeBusinesses,
      newThisMonth,
      totalItems,
      totalTxns,
      txnsThisWeek,
      recentLogins,
      businessList
    ] = await Promise.all([
      InventoryBusiness.countDocuments(),
      InventoryBusiness.countDocuments({ isActive: true }),
      InventoryBusiness.countDocuments({ createdAt: { $gte: since30 } }),
      InventoryItem.countDocuments({ isActive: true }),
      InventoryStockTransaction.countDocuments(),
      InventoryStockTransaction.countDocuments({ createdAt: { $gte: since7 } }),
      InventoryActivityLog.find({ action: 'login' })
        .sort({ createdAt: -1 }).limit(30).lean(),
      InventoryBusiness.find()
        .select('-password -token')
        .sort({ createdAt: -1 })
        .lean()
    ]);

    // Per-business stats
    const businessIds = businessList.map(b => b._id);
    const [itemCounts, txnCounts, loginCounts, revAgg] = await Promise.all([
      InventoryItem.aggregate([
        { $match: { business: { $in: businessIds }, isActive: true } },
        { $group: { _id: '$business', count: { $sum: 1 } } }
      ]),
      InventoryStockTransaction.aggregate([
        { $match: { business: { $in: businessIds } } },
        { $group: { _id: '$business', count: { $sum: 1 } } }
      ]),
      InventoryActivityLog.aggregate([
        { $match: { business: { $in: businessIds }, action: 'login' } },
        { $group: { _id: '$business', count: { $sum: 1 }, last: { $max: '$createdAt' } } }
      ]),
      InventoryStockTransaction.aggregate([
        { $match: { business: { $in: businessIds } } },
        { $group: { _id: '$type', total: { $sum: '$totalAmount' } } }
      ])
    ]);

    const itemMap  = Object.fromEntries(itemCounts.map(x  => [x._id.toString(), x.count]));
    const txnMap   = Object.fromEntries(txnCounts.map(x   => [x._id.toString(), x.count]));
    const loginMap = Object.fromEntries(loginCounts.map(x => [x._id.toString(), { count: x.count, last: x.last }]));

    // Revenue totals
    const revMap = Object.fromEntries(revAgg.map(r => [r._id, r.total || 0]));
    const totalPurchaseValue = revMap['purchase'] || 0;
    const totalSaleValue     = revMap['sale']     || 0;

    const businesses = businessList.map(b => ({
      ...b,
      _itemCount:  itemMap[b._id.toString()]           || 0,
      _txnCount:   txnMap[b._id.toString()]            || 0,
      _loginCount: loginMap[b._id.toString()]?.count   || b.loginCount || 0,
      _lastLogin:  loginMap[b._id.toString()]?.last    || b.lastLoginAt
    }));

    res.json({
      overview: { totalBusinesses, activeBusinesses, newThisMonth, totalItems, totalTxns, txnsThisWeek, totalPurchaseValue, totalSaleValue },
      businesses,
      recentLogins
    });
  } catch (err) {
    console.error('Admin monitor error:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET /api/inventory/admin/activity?businessId=&action=&page=1&limit=50
router.get('/admin/activity', adminAuth, async (req, res) => {
  try {
    const { businessId, action, page = 1, limit = 50 } = req.query;
    const query = {};
    if (businessId && mongoose.Types.ObjectId.isValid(businessId)) query.business = businessId;
    if (action) query.action = action;

    const [logs, total] = await Promise.all([
      InventoryActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip((+page - 1) * +limit)
        .limit(+limit)
        .lean(),
      InventoryActivityLog.countDocuments(query)
    ]);

    res.json({ logs, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/inventory/admin/business/:id  — single business detail + stats
router.get('/admin/business/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID.' });

    const business = await InventoryBusiness.findById(req.params.id).select('-password -token').lean();
    if (!business) return res.status(404).json({ message: 'Business not found.' });

    const bId = business._id;
    const [items, categories, suppliers, txns, activityLogs] = await Promise.all([
      InventoryItem.countDocuments({ business: bId, isActive: true }),
      InventoryCategory.countDocuments({ business: bId }),
      InventorySupplier.countDocuments({ business: bId }),
      InventoryStockTransaction.countDocuments({ business: bId }),
      InventoryActivityLog.find({ business: bId }).sort({ createdAt: -1 }).limit(50).lean()
    ]);

    const txnBreakdown = await InventoryStockTransaction.aggregate([
      { $match: { business: bId } },
      { $group: { _id: '$type', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } }
    ]);

    const loginAgg = await InventoryActivityLog.aggregate([
      { $match: { business: bId, action: 'login' } },
      { $group: { _id: null, count: { $sum: 1 }, last: { $max: '$createdAt' } } }
    ]);
    const loginCount = loginAgg[0]?.count || business.loginCount || 0;
    const lastLogin  = loginAgg[0]?.last  || business.lastLoginAt || null;

    res.json({
      business,
      stats: { items, categories, suppliers, txns, loginCount, lastLogin },
      txnBreakdown,
      activityLogs
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/inventory/admin/business/:id/toggle  — activate / deactivate account
router.patch('/admin/business/:id/toggle', adminAuth, async (req, res) => {
  try {
    const business = await InventoryBusiness.findById(req.params.id);
    if (!business) return res.status(404).json({ message: 'Business not found.' });
    business.isActive = !business.isActive;
    await business.save();
    res.json({ message: `Account ${business.isActive ? 'activated' : 'deactivated'}.`, isActive: business.isActive });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════ CUSTOMERS ══════════════════════════════════════

// GET /api/inventory/customers
router.get('/customers', inventoryAuth, async (req, res) => {
  try {
    const { search, group, page = 1, limit = 50 } = req.query;
    const query = { business: req.business._id, isActive: true };
    if (search) query.$or = [
      { name: new RegExp(search, 'i') },
      { phone: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
    ];
    if (group) query.group = group;
    const [customers, total] = await Promise.all([
      InventoryCustomer.find(query).sort({ name: 1 }).skip((+page - 1) * +limit).limit(+limit).lean(),
      InventoryCustomer.countDocuments(query)
    ]);
    res.json({ customers, total, page: +page });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/inventory/customers
router.post('/customers', inventoryAuth, async (req, res) => {
  try {
    const { name, phone, email, address, gstin, group, notes } = req.body;
    if (!name) return res.status(400).json({ message: 'Customer name is required.' });
    const customer = await InventoryCustomer.create({
      business: req.business._id,
      name: name.trim(),
      phone: phone?.trim() || undefined,
      email: email?.trim()?.toLowerCase() || undefined,
      address, gstin: gstin?.trim() || undefined,
      group: group || 'retail',
      notes: notes?.trim() || undefined,
    });
    res.status(201).json(customer);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/inventory/customers/:id
router.get('/customers/:id', inventoryAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID.' });
    const customer = await InventoryCustomer.findOne({ _id: req.params.id, business: req.business._id }).lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    const invoices = await InventoryInvoice.find({ business: req.business._id, customer: req.params.id })
      .sort({ invoiceDate: -1 }).limit(50).lean();
    res.json({ customer, invoices });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/inventory/customers/:id
router.put('/customers/:id', inventoryAuth, async (req, res) => {
  try {
    const customer = await InventoryCustomer.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { $set: req.body }, { new: true, runValidators: true }
    );
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    res.json(customer);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/inventory/customers/:id
router.delete('/customers/:id', inventoryAuth, async (req, res) => {
  try {
    await InventoryCustomer.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { isActive: false }
    );
    res.json({ message: 'Customer deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ═══════════════════════════ INVOICES ═══════════════════════════════════════

async function generateInvoiceNumber(businessId) {
  const d   = new Date();
  const ym  = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const count = await InventoryInvoice.countDocuments({ business: businessId });
  return `INV-${ym}-${String(count + 1).padStart(4, '0')}`;
}

// GET /api/inventory/invoices/stats  (must be before /:id)
router.get('/invoices/stats', inventoryAuth, async (req, res) => {
  try {
    const bId = req.business._id;
    const now  = new Date();
    const startOfMonth     = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [totalInvoices, paidAgg, unpaidAgg, thisMonthAgg, lastMonthAgg, topCustomers, monthlyTrend] =
      await Promise.all([
        InventoryInvoice.countDocuments({ business: bId }),
        InventoryInvoice.aggregate([
          { $match: { business: bId, paymentStatus: 'paid' } },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' } } }
        ]),
        InventoryInvoice.aggregate([
          { $match: { business: bId, paymentStatus: { $in: ['unpaid', 'partial'] } } },
          { $group: { _id: null, count: { $sum: 1 }, totalDue: { $sum: '$amountDue' } } }
        ]),
        InventoryInvoice.aggregate([
          { $match: { business: bId, invoiceDate: { $gte: startOfMonth } } },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$grandTotal' }, collected: { $sum: '$amountPaid' } } }
        ]),
        InventoryInvoice.aggregate([
          { $match: { business: bId, invoiceDate: { $gte: startOfLastMonth, $lte: endOfLastMonth } } },
          { $group: { _id: null, total: { $sum: '$grandTotal' } } }
        ]),
        InventoryInvoice.aggregate([
          { $match: { business: bId } },
          { $group: { _id: '$customer', totalAmount: { $sum: '$grandTotal' }, invoiceCount: { $sum: 1 } } },
          { $sort: { totalAmount: -1 } }, { $limit: 5 },
          { $lookup: { from: 'inventorycustomers', localField: '_id', foreignField: '_id', as: 'cust' } },
          { $project: { name: { $ifNull: [{ $arrayElemAt: ['$cust.name', 0] }, 'Walk-in'] }, totalAmount: 1, invoiceCount: 1 } }
        ]),
        InventoryInvoice.aggregate([
          { $match: { business: bId, invoiceDate: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } },
          { $group: { _id: { year: { $year: '$invoiceDate' }, month: { $month: '$invoiceDate' } }, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
          { $sort: { '_id.year': 1, '_id.month': 1 } }
        ])
      ]);

    res.json({
      totalInvoices,
      paidCount:       paidAgg[0]?.count    || 0,
      paidAmount:      paidAgg[0]?.total    || 0,
      unpaidCount:     unpaidAgg[0]?.count  || 0,
      unpaidDue:       unpaidAgg[0]?.totalDue || 0,
      thisMonth:       thisMonthAgg[0]      || { count: 0, total: 0, collected: 0 },
      lastMonthTotal:  lastMonthAgg[0]?.total || 0,
      topCustomers,
      monthlyTrend
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/inventory/invoices
router.get('/invoices', inventoryAuth, async (req, res) => {
  try {
    const { paymentStatus, customerId, from, to, month, page = 1, limit = 30 } = req.query;
    const query = { business: req.business._id };
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) query.customer = customerId;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      query.invoiceDate = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) };
    } else if (from || to) {
      query.invoiceDate = {};
      if (from) query.invoiceDate.$gte = new Date(from);
      if (to)   query.invoiceDate.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
    }
    const [invoices, total] = await Promise.all([
      InventoryInvoice.find(query).sort({ invoiceDate: -1 }).skip((+page - 1) * +limit).limit(+limit).lean(),
      InventoryInvoice.countDocuments(query)
    ]);
    res.json({ invoices, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/inventory/invoices/:id
router.get('/invoices/:id', inventoryAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ message: 'Invalid ID.' });
    const invoice = await InventoryInvoice.findOne({ _id: req.params.id, business: req.business._id })
      .populate('customer', 'name phone email gstin address').lean();
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    res.json(invoice);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/inventory/invoices
router.post('/invoices', inventoryAuth, async (req, res) => {
  try {
    const bId = req.business._id;
    const invoiceNumber = await generateInvoiceNumber(bId);
    const {
      customer: customerId, customerName, customerPhone, customerEmail,
      customerAddress, customerGstin,
      items = [], subtotal = 0, discountAmount = 0, taxAmount = 0, grandTotal = 0,
      amountPaid = 0, paymentMethod, invoiceDate, dueDate, notes, terms, status = 'sent'
    } = req.body;

    const amountDue = Math.max(0, grandTotal - amountPaid);
    const paymentStatus = amountPaid <= 0 ? 'unpaid' : amountDue <= 0 ? 'paid' : 'partial';

    const invoice = await InventoryInvoice.create({
      business: bId, invoiceNumber,
      customer: customerId && mongoose.Types.ObjectId.isValid(customerId) ? customerId : undefined,
      customerName, customerPhone, customerEmail, customerAddress, customerGstin,
      items, subtotal, discountAmount, taxAmount, grandTotal,
      amountPaid, amountDue, paymentStatus,
      paymentMethod: paymentMethod || 'cash',
      invoiceDate: invoiceDate ? new Date(invoiceDate) : new Date(),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes, terms, status
    });

    // Update customer aggregate stats
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      await InventoryCustomer.findByIdAndUpdate(customerId, {
        $inc: { totalInvoices: 1, totalAmount: grandTotal, totalPaid: +amountPaid, outstandingDue: amountDue },
        $set: { lastPurchaseAt: new Date() }
      });
    }

    logActivity(req, req.business, 'transaction_create', {
      entity: 'invoice', entityId: invoice._id, entityName: invoice.invoiceNumber,
      details: { grandTotal, customerName }
    });
    res.status(201).json(invoice);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/inventory/invoices/:id
router.put('/invoices/:id', inventoryAuth, async (req, res) => {
  try {
    if (req.body.grandTotal !== undefined || req.body.amountPaid !== undefined) {
      const existing = await InventoryInvoice.findOne({ _id: req.params.id, business: req.business._id }).lean();
      const gt  = req.body.grandTotal  ?? existing?.grandTotal  ?? 0;
      const ap  = req.body.amountPaid  ?? existing?.amountPaid  ?? 0;
      const due = Math.max(0, gt - ap);
      req.body.amountDue      = due;
      req.body.paymentStatus  = ap <= 0 ? 'unpaid' : due <= 0 ? 'paid' : 'partial';
    }
    const invoice = await InventoryInvoice.findOneAndUpdate(
      { _id: req.params.id, business: req.business._id },
      { $set: req.body }, { new: true }
    );
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    res.json(invoice);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/inventory/invoices/:id
router.delete('/invoices/:id', inventoryAuth, async (req, res) => {
  try {
    const inv = await InventoryInvoice.findOneAndDelete({ _id: req.params.id, business: req.business._id });
    if (!inv) return res.status(404).json({ message: 'Invoice not found.' });
    // Reverse customer stats
    if (inv.customer) {
      await InventoryCustomer.findByIdAndUpdate(inv.customer, {
        $inc: { totalInvoices: -1, totalAmount: -inv.grandTotal, totalPaid: -inv.amountPaid, outstandingDue: -inv.amountDue }
      });
    }
    res.json({ message: 'Invoice deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── GET /api/inventory/search?q=&type=items|customers|both&limit=20 ─────────
router.get('/search', inventoryAuth, async (req, res) => {
  try {
    const { q = '', type = 'both', limit = 20 } = req.query;
    const bId = req.business._id;
    const term = q.trim();
    const results = {};

    if (type === 'items' || type === 'both') {
      const itemQuery = { business: bId, isActive: true };
      if (term) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        itemQuery.$or = [{ name: regex }, { sku: regex }, { barcode: regex }];
      }
      results.items = await InventoryItem.find(itemQuery)
        .select('name sku barcode unit currentStock minStock sellingPrice costPrice')
        .sort({ name: 1 })
        .limit(Math.min(Number(limit), 100))
        .lean();
    }

    if (type === 'customers' || type === 'both') {
      const custQuery = { business: bId, isActive: true };
      if (term) {
        const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        custQuery.$or = [{ name: regex }, { phone: regex }, { email: regex }];
      }
      results.customers = await InventoryCustomer.find(custQuery)
        .select('name phone email group')
        .sort({ name: 1 })
        .limit(Math.min(Number(limit), 100))
        .lean();
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
