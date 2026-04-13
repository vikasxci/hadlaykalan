const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const multer  = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

const saloonAuth = require('../middleware/saloonAuth');
const { requireRole } = saloonAuth;

const SaloonBusiness  = require('../models/SaloonBusiness');
const SaloonStaff     = require('../models/SaloonStaff');
const SaloonService   = require('../models/SaloonService');
const SaloonWorkEntry = require('../models/SaloonWorkEntry');
const SaloonCustomer  = require('../models/SaloonCustomer');
const SaloonAttendance = require('../models/SaloonAttendance');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ── Cloudinary upload for customer photos ─────────────────────────────────────
const photoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'hadlay-kalan/saloon',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }]
  }
});
const uploadPhoto = multer({ storage: photoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeToken(staffId, saloonId, role) {
  return jwt.sign({ staffId, saloonId, role }, JWT_SECRET, { expiresIn: '30d' });
}
function slugify(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').substring(0, 50);
}
async function nextBillNumber(saloonId) {
  const n = await SaloonWorkEntry.countDocuments({ saloon: saloonId });
  return `SAL-${String(n + 1).padStart(5, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

// POST /api/saloon/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { ownerName, businessName, email, phone, password, businessType, city, gstin } = req.body;
    if (!ownerName || !businessName || !email || !phone || !password)
      return res.status(400).json({ message: 'ownerName, businessName, email, phone and password are required.' });

    const existing = await SaloonBusiness.findOne({ $or: [{ email: email.toLowerCase() }, { phone: phone.trim() }] });
    if (existing) return res.status(409).json({ message: 'Email or phone already registered.' });

    let base = slugify(businessName), slug = base, n = 1;
    while (await SaloonBusiness.findOne({ slug })) slug = `${base}-${n++}`;

    const saloon = await SaloonBusiness.create({
      businessName: businessName.trim(),
      ownerName: ownerName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      slug,
      businessType: businessType || 'salon',
      gstin,
      'address.city': city || ''
    });

    const owner = await SaloonStaff.create({
      saloon: saloon._id,
      name: ownerName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      role: 'owner'
    });

    const token = makeToken(owner._id, saloon._id, 'owner');
    owner.token = token;
    await owner.save({ validateBeforeSave: false });
    saloon.token = token;
    await saloon.save({ validateBeforeSave: false });

    res.status(201).json({
      message: 'Saloon registered.',
      token,
      staff: owner.toSafeObject(),
      saloon: saloon.toSafeObject()
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Email or phone already registered.' });
    res.status(500).json({ message: err.message });
  }
});

// POST /api/saloon/auth/login  (owner / manager full login)
router.post('/auth/login', async (req, res) => {
  try {
    const { emailOrPhone, password, saloonId } = req.body;
    if (!emailOrPhone || !password) return res.status(400).json({ message: 'Email/phone and password required.' });

    const q = saloonId
      ? { saloon: saloonId, $or: [{ email: emailOrPhone.toLowerCase() }, { phone: emailOrPhone }] }
      : { $or: [{ email: emailOrPhone.toLowerCase() }, { phone: emailOrPhone }] };

    const staff = await SaloonStaff.findOne(q);
    if (!staff || !staff.password) return res.status(401).json({ message: 'Invalid credentials.' });
    if (!await staff.comparePassword(password)) return res.status(401).json({ message: 'Invalid credentials.' });
    if (!staff.isActive) return res.status(403).json({ message: 'Account deactivated.' });

    const saloon = await SaloonBusiness.findById(staff.saloon);
    if (!saloon || !saloon.isActive) return res.status(403).json({ message: 'Saloon account inactive.' });

    const token = makeToken(staff._id, saloon._id, staff.role);
    staff.token = token;
    staff.lastLoginAt = new Date();
    staff.loginCount = (staff.loginCount || 0) + 1;
    await staff.save({ validateBeforeSave: false });

    res.json({ token, staff: staff.toSafeObject(), saloon: saloon.toSafeObject() });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/auth/pin-login  (staff PIN login)
router.post('/auth/pin-login', async (req, res) => {
  try {
    const { saloonId, pin } = req.body;
    if (!saloonId || !pin) return res.status(400).json({ message: 'saloonId and pin required.' });

    const staffList = await SaloonStaff.find({ saloon: saloonId, isActive: true, pin: { $exists: true, $ne: null } });
    let matched = null;
    for (const s of staffList) {
      if (s.pin && await s.comparePin(pin)) { matched = s; break; }
    }
    if (!matched) return res.status(401).json({ message: 'Invalid PIN.' });

    const saloon = await SaloonBusiness.findById(saloonId);
    if (!saloon || !saloon.isActive) return res.status(403).json({ message: 'Saloon account inactive.' });

    const token = makeToken(matched._id, saloon._id, matched.role);
    matched.token = token;
    matched.lastLoginAt = new Date();
    matched.loginCount = (matched.loginCount || 0) + 1;
    await matched.save({ validateBeforeSave: false });

    res.json({ token, staff: matched.toSafeObject(), saloon: saloon.toSafeObject() });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/auth/logout
router.post('/auth/logout', saloonAuth, async (req, res) => {
  try {
    await SaloonStaff.findByIdAndUpdate(req.staff._id, { $unset: { token: 1 } });
    res.json({ message: 'Logged out.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/saloon/auth/me
router.get('/auth/me', saloonAuth, async (req, res) => {
  res.json({ staff: req.staff, saloon: req.saloon });
});

// ════════════════════════════════════════════════════════════════════════════
// STAFF MANAGEMENT  (owner / manager only)
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/staff
router.get('/staff', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const list = await SaloonStaff.find({ saloon: req.saloon._id })
      .select('-password -pin -token').sort({ createdAt: 1 }).lean();
    res.json(list);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/staff
router.post('/staff', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, email, phone, role, pin, password, specializations, salary, commissionType, commissionValue, designation, joiningDate } = req.body;
    if (!name || !role) return res.status(400).json({ message: 'name and role are required.' });

    const staff = await SaloonStaff.create({
      saloon: req.saloon._id,
      name: name.trim(), email, phone,
      role, pin, password,
      specializations: specializations || [],
      salary: salary || 0,
      commissionType: commissionType || 'percent',
      commissionValue: commissionValue ?? 40,
      designation, joiningDate
    });
    res.status(201).json(staff.toSafeObject());
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'Phone or email already used.' });
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/saloon/staff/:id
router.put('/staff/:id', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const staff = await SaloonStaff.findOne({ _id: req.params.id, saloon: req.saloon._id });
    if (!staff) return res.status(404).json({ message: 'Staff not found.' });

    const fields = ['name', 'email', 'phone', 'role', 'specializations', 'salary', 'commissionType', 'commissionValue', 'designation', 'joiningDate', 'isActive'];
    fields.forEach(f => { if (req.body[f] !== undefined) staff[f] = req.body[f]; });

    if (req.body.password) staff.password = req.body.password;
    if (req.body.pin)      staff.pin      = req.body.pin;

    await staff.save();
    res.json(staff.toSafeObject());
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/saloon/staff/:id
router.delete('/staff/:id', saloonAuth, requireRole('owner'), async (req, res) => {
  try {
    const staff = await SaloonStaff.findOne({ _id: req.params.id, saloon: req.saloon._id });
    if (!staff) return res.status(404).json({ message: 'Staff not found.' });
    if (staff.role === 'owner') return res.status(400).json({ message: 'Cannot delete owner.' });
    await SaloonStaff.findByIdAndDelete(staff._id);
    res.json({ message: 'Staff deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/staff/:id/avatar
router.post('/staff/:id/avatar', saloonAuth, requireRole('owner', 'manager'), uploadPhoto.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const staff = await SaloonStaff.findOneAndUpdate(
      { _id: req.params.id, saloon: req.saloon._id },
      { avatar: req.file.path },
      { new: true }
    );
    if (!staff) return res.status(404).json({ message: 'Staff not found.' });
    res.json({ avatar: staff.avatar });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SERVICES
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/services
router.get('/services', saloonAuth, async (req, res) => {
  try {
    const services = await SaloonService.find({ saloon: req.saloon._id, isActive: true })
      .sort({ category: 1, sortOrder: 1, name: 1 }).lean();
    res.json(services);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/services
router.post('/services', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { name, category, price, duration, gender, description } = req.body;
    if (!name || price === undefined) return res.status(400).json({ message: 'name and price are required.' });
    const service = await SaloonService.create({ saloon: req.saloon._id, name, category, price, duration, gender, description });
    res.status(201).json(service);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/saloon/services/:id
router.put('/services/:id', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const service = await SaloonService.findOneAndUpdate(
      { _id: req.params.id, saloon: req.saloon._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!service) return res.status(404).json({ message: 'Service not found.' });
    res.json(service);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE /api/saloon/services/:id
router.delete('/services/:id', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    await SaloonService.findOneAndUpdate(
      { _id: req.params.id, saloon: req.saloon._id },
      { isActive: false }
    );
    res.json({ message: 'Service removed.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// WORK ENTRIES (BILLS)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/saloon/entries  — staff creates a new work entry / bill
router.post('/entries', saloonAuth, uploadPhoto.single('customerPhoto'), async (req, res) => {
  try {
    let body = req.body;
    if (typeof body.services === 'string') {
      try { body.services = JSON.parse(body.services); } catch { body.services = []; }
    }

    const { customerName, customerPhone, customerId, services, paymentMode, paymentStatus, amountPaid, notes, serviceDate } = body;

    if (!services || !Array.isArray(services) || services.length === 0)
      return res.status(400).json({ message: 'At least one service is required.' });

    const billNumber = await nextBillNumber(req.saloon._id);

    // Compute totals
    let subtotal = 0, discountTotal = 0, staffEarningTotal = 0;
    const commType = req.staff.commissionType || req.saloon.settings?.commissionType || 'percent';
    const commVal  = req.staff.commissionValue ?? req.saloon.settings?.commissionValue ?? 40;

    const serviceLines = services.map(s => {
      const lineTotal = (s.price || 0) * (s.qty || 1);
      const disc      = s.discount || 0;
      const net       = lineTotal - disc;
      const earning   = commType === 'percent' ? (net * commVal / 100) : commVal;
      subtotal     += net;
      discountTotal += disc;
      staffEarningTotal += earning;
      return { ...s, staffEarning: Math.round(earning) };
    });

    const taxPct     = req.saloon.settings?.taxPercent || 0;
    const taxAmount  = Math.round(subtotal * taxPct / 100);
    const grandTotal = subtotal + taxAmount;
    const paid       = parseFloat(amountPaid || grandTotal);

    const entry = await SaloonWorkEntry.create({
      saloon:        req.saloon._id,
      staff:         req.staff._id,
      staffName:     req.staff.name,
      billNumber,
      customer:      customerId || undefined,
      customerName:  customerName || 'Walk-in',
      customerPhone,
      customerPhoto: req.file ? req.file.path : undefined,
      services:      serviceLines,
      subtotal:      Math.round(subtotal),
      discountTotal,
      taxAmount,
      grandTotal:    Math.round(grandTotal),
      staffEarning:  Math.round(staffEarningTotal),
      paymentMode:   paymentMode || 'cash',
      paymentStatus: paymentStatus || 'paid',
      amountPaid:    Math.round(paid),
      amountDue:     Math.max(0, Math.round(grandTotal - paid)),
      notes,
      serviceDate:   serviceDate ? new Date(serviceDate) : new Date()
    });

    // Update customer stats if linked
    if (customerId) {
      await SaloonCustomer.findByIdAndUpdate(customerId, {
        $inc: { totalVisits: 1, totalSpent: grandTotal },
        $set: { lastVisitAt: new Date() }
      });
    }

    // Add photo to customer gallery
    if (req.file && customerId) {
      await SaloonCustomer.findByIdAndUpdate(customerId, {
        $push: { photos: { url: req.file.path, workEntry: entry._id, takenAt: new Date() } }
      });
    }

    res.status(201).json(entry);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/saloon/entries  — filtered list
router.get('/entries', saloonAuth, async (req, res) => {
  try {
    const { from, to, staffId, page = 1, limit = 50 } = req.query;
    const q = { saloon: req.saloon._id };

    // Non-owner staff can only see their own entries
    if (!['owner', 'manager'].includes(req.staff.role)) {
      q.staff = req.staff._id;
    } else if (staffId) {
      q.staff = staffId;
    }

    if (from || to) {
      q.serviceDate = {};
      if (from) q.serviceDate.$gte = new Date(from);
      if (to)   { const d = new Date(to); d.setHours(23, 59, 59); q.serviceDate.$lte = d; }
    }

    const [entries, total] = await Promise.all([
      SaloonWorkEntry.find(q)
        .sort({ serviceDate: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      SaloonWorkEntry.countDocuments(q)
    ]);
    res.json({ entries, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/saloon/entries/:id
router.get('/entries/:id', saloonAuth, async (req, res) => {
  try {
    const entry = await SaloonWorkEntry.findOne({ _id: req.params.id, saloon: req.saloon._id })
      .populate('staff', 'name role avatar')
      .lean();
    if (!entry) return res.status(404).json({ message: 'Entry not found.' });
    res.json(entry);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/saloon/entries/:id  (owner / manager can edit)
router.put('/entries/:id', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const entry = await SaloonWorkEntry.findOneAndUpdate(
      { _id: req.params.id, saloon: req.saloon._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!entry) return res.status(404).json({ message: 'Entry not found.' });
    res.json(entry);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/customers
router.get('/customers', saloonAuth, async (req, res) => {
  try {
    const { q, page = 1, limit = 30 } = req.query;
    const filter = { saloon: req.saloon._id, isActive: true };
    if (q) filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { phone: { $regex: q, $options: 'i' } }
    ];
    const [customers, total] = await Promise.all([
      SaloonCustomer.find(filter).sort({ totalVisits: -1 }).skip((page - 1) * limit).limit(Number(limit)).lean(),
      SaloonCustomer.countDocuments(filter)
    ]);
    res.json({ customers, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/customers
router.post('/customers', saloonAuth, async (req, res) => {
  try {
    const { name, phone, email, gender, birthdate, notes, preferredStaff } = req.body;
    if (!name || !phone) return res.status(400).json({ message: 'name and phone are required.' });
    const existing = await SaloonCustomer.findOne({ saloon: req.saloon._id, phone: phone.trim() });
    if (existing) return res.status(409).json(existing);
    const customer = await SaloonCustomer.create({
      saloon: req.saloon._id,
      name: name.trim(), phone: phone.trim(), email, gender, birthdate, notes, preferredStaff,
      firstVisitAt: new Date()
    });
    res.status(201).json(customer);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/saloon/customers/:id  (with visit history)
router.get('/customers/:id', saloonAuth, async (req, res) => {
  try {
    const customer = await SaloonCustomer.findOne({ _id: req.params.id, saloon: req.saloon._id }).lean();
    if (!customer) return res.status(404).json({ message: 'Customer not found.' });
    const history = await SaloonWorkEntry.find({ saloon: req.saloon._id, customer: customer._id })
      .sort({ serviceDate: -1 }).limit(20).lean();
    res.json({ customer, history });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/attendance?month=YYYY-MM&staffId=...
router.get('/attendance', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { month, staffId } = req.query;
    const q = { saloon: req.saloon._id };
    if (staffId) q.staff = staffId;
    if (month) {
      const [y, m] = month.split('-').map(Number);
      q.date = { $gte: new Date(y, m - 1, 1), $lte: new Date(y, m, 0, 23, 59, 59) };
    }
    const records = await SaloonAttendance.find(q).populate('staff', 'name role avatar').sort({ date: -1 }).lean();
    res.json(records);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/attendance
router.post('/attendance', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { staffId, date, status, checkIn, checkOut, note } = req.body;
    if (!staffId || !date) return res.status(400).json({ message: 'staffId and date required.' });
    const record = await SaloonAttendance.findOneAndUpdate(
      { saloon: req.saloon._id, staff: staffId, date: new Date(date) },
      { status: status || 'present', checkIn, checkOut, note },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(record);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD & REPORTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/dashboard
router.get('/dashboard', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const saloonId = req.saloon._id;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

    // This month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    const [
      todayEntries,
      monthEntries,
      totalCustomers,
      totalStaff,
      recentEntries
    ] = await Promise.all([
      SaloonWorkEntry.aggregate([
        { $match: { saloon: saloonId, serviceDate: { $gte: today, $lte: todayEnd } } },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' }, count: { $sum: 1 }, staffEarning: { $sum: '$staffEarning' } } }
      ]),
      SaloonWorkEntry.aggregate([
        { $match: { saloon: saloonId, serviceDate: { $gte: monthStart, $lte: monthEnd } } },
        { $group: { _id: null, revenue: { $sum: '$grandTotal' }, count: { $sum: 1 }, staffEarning: { $sum: '$staffEarning' } } }
      ]),
      SaloonCustomer.countDocuments({ saloon: saloonId, isActive: true }),
      SaloonStaff.countDocuments({ saloon: saloonId, isActive: true }),
      SaloonWorkEntry.find({ saloon: saloonId })
        .sort({ createdAt: -1 }).limit(10)
        .populate('staff', 'name avatar').lean()
    ]);

    // Staff performance this month
    const staffPerf = await SaloonWorkEntry.aggregate([
      { $match: { saloon: saloonId, serviceDate: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: '$staff', name: { $first: '$staffName' }, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' }, earning: { $sum: '$staffEarning' } } },
      { $sort: { revenue: -1 } }
    ]);

    res.json({
      today: todayEntries[0] || { revenue: 0, count: 0, staffEarning: 0 },
      month: monthEntries[0] || { revenue: 0, count: 0, staffEarning: 0 },
      totalCustomers,
      totalStaff,
      recentEntries,
      staffPerformance: staffPerf
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// GET /api/saloon/reports/staff  — per-staff earnings report
router.get('/reports/staff', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = { saloon: req.saloon._id };
    if (from || to) {
      match.serviceDate = {};
      if (from) match.serviceDate.$gte = new Date(from);
      if (to) { const d = new Date(to); d.setHours(23, 59, 59); match.serviceDate.$lte = d; }
    }
    const data = await SaloonWorkEntry.aggregate([
      { $match: match },
      { $group: { _id: '$staff', name: { $first: '$staffName' }, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' }, earning: { $sum: '$staffEarning' } } },
      { $sort: { revenue: -1 } }
    ]);
    res.json(data);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SALOON SETTINGS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/saloon/settings
router.get('/settings', saloonAuth, requireRole('owner', 'manager'), async (req, res) => {
  try {
    const saloon = await SaloonBusiness.findById(req.saloon._id).select('-password -token').lean();
    res.json(saloon);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// PUT /api/saloon/settings
router.put('/settings', saloonAuth, requireRole('owner'), async (req, res) => {
  try {
    const allowed = ['businessName', 'ownerName', 'phone', 'businessType', 'address', 'gstin', 'hours', 'settings'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const saloon = await SaloonBusiness.findByIdAndUpdate(req.saloon._id, update, { new: true }).select('-password -token');
    res.json(saloon.toSafeObject ? saloon.toSafeObject() : saloon);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST /api/saloon/settings/logo
router.post('/settings/logo', saloonAuth, requireRole('owner'), uploadPhoto.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded.' });
    const saloon = await SaloonBusiness.findByIdAndUpdate(req.saloon._id, { logo: req.file.path }, { new: true });
    res.json({ logo: saloon.logo });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
