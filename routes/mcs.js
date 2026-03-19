const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const MCSCustomer   = require('../models/MCSCustomer');
const MCSCollection = require('../models/MCSCollection');
const MCSTariff     = require('../models/MCSTariff');
const MCSPayment    = require('../models/MCSPayment');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — get rate for a given fat% and animalType from active tariff
// ─────────────────────────────────────────────────────────────────────────────
async function getRate(animalType, fat) {
  const tariff = await MCSTariff.findOne({ animalType, isActive: true }).sort({ updatedAt: -1 });
  if (!tariff) return 0;
  if (tariff.rateType === 'flat') return tariff.flatRate;
  // fat-based
  const band = tariff.fatRates.find(b => fat >= b.minFat && fat <= b.maxFat);
  return band ? band.ratePerLitre : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER LOGIN  (public – phone + pin)
// POST /api/mcs/customer-login
// ─────────────────────────────────────────────────────────────────────────────
router.post('/customer-login', async (req, res) => {
  try {
    const { customerId, pin } = req.body;
    if (!customerId || !pin) return res.status(400).json({ message: 'customerId और PIN आवश्यक हैं' });

    const customer = await MCSCustomer.findOne({ customerId: customerId.toUpperCase(), isActive: true });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });
    if (customer.pin !== String(pin)) return res.status(401).json({ message: 'गलत PIN' });

    // return sanitised customer (no pin)
    const obj = customer.toObject();
    delete obj.pin;
    res.json({ success: true, customer: obj });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER SELF-VIEW  (public – requires customerId in query)
// GET /api/mcs/customer-data/:customerId?month=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────
router.get('/customer-data/:customerId', async (req, res) => {
  try {
    const customer = await MCSCustomer.findOne({ customerId: req.params.customerId.toUpperCase() });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });

    const { month } = req.query; // e.g. '2025-03'
    const filter = { customer: customer._id };
    if (month) filter.date = { $regex: `^${month}` };

    const [collections, payments] = await Promise.all([
      MCSCollection.find(filter).sort({ date: -1, shift: 1 }),
      MCSPayment.find({ customer: customer._id, ...(month ? { period: month } : {}) }).sort({ paymentDate: -1 })
    ]);

    const totalLitres  = collections.reduce((s, c) => s + c.qty, 0);
    const totalAmount  = collections.reduce((s, c) => s + c.amount, 0);
    const totalPaid    = payments.reduce((s, p) => s + p.amount, 0);

    const obj = customer.toObject();
    delete obj.pin;

    res.json({ customer: obj, collections, payments, summary: { totalLitres, totalAmount, totalPaid, due: totalAmount - totalPaid } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD  (admin)
// GET /api/mcs/dashboard?date=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
router.get('/dashboard', auth, async (req, res) => {
  try {
    const date  = req.query.date || new Date().toISOString().slice(0, 10);
    const month = date.slice(0, 7);

    const [todayCollections, monthCollections, pendingPayments, totalCustomers] = await Promise.all([
      MCSCollection.find({ date }).populate('customer', 'name customerId animalType'),
      MCSCollection.find({ date: { $regex: `^${month}` } }),
      // customers whose monthly earned > paid
      MCSCustomer.find({ isActive: true }),
      MCSCustomer.countDocuments({ isActive: true })
    ]);

    const todayLitres  = todayCollections.reduce((s, c) => s + c.qty, 0);
    const todayAmount  = todayCollections.reduce((s, c) => s + c.amount, 0);
    const monthLitres  = monthCollections.reduce((s, c) => s + c.qty, 0);
    const monthAmount  = monthCollections.reduce((s, c) => s + c.amount, 0);

    res.json({
      date, month,
      today:  { litres: todayLitres, amount: todayAmount, entries: todayCollections.length, collections: todayCollections },
      monthSummary: { litres: monthLitres, amount: monthAmount },
      totalCustomers
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS  (admin CRUD)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/customers', auth, async (req, res) => {
  try {
    const customers = await MCSCustomer.find().sort({ customerId: 1 });
    res.json(customers);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/customers', auth, async (req, res) => {
  try {
    const { name, phone, address, animalType, pin, note } = req.body;
    if (!name) return res.status(400).json({ message: 'नाम आवश्यक है' });
    const customer = new MCSCustomer({ name, phone, address, animalType, pin: pin || '1234', note });
    await customer.save();
    res.status(201).json(customer);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'ग्राहक ID पहले से मौजूद है' });
    res.status(500).json({ message: err.message });
  }
});

router.put('/customers/:id', auth, async (req, res) => {
  try {
    const updates = (({ name, phone, address, animalType, pin, note, isActive }) =>
      ({ name, phone, address, animalType, pin, note, isActive }))(req.body);
    const customer = await MCSCustomer.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });
    res.json(customer);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/customers/:id', auth, async (req, res) => {
  try {
    const customer = await MCSCustomer.findByIdAndDelete(req.params.id);
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });
    // Also remove their collections & payments
    await Promise.all([
      MCSCollection.deleteMany({ customer: req.params.id }),
      MCSPayment.deleteMany({ customer: req.params.id })
    ]);
    res.json({ message: 'ग्राहक हटाया गया' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TARIFFS  (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tariffs', auth, async (req, res) => {
  try {
    const tariffs = await MCSTariff.find().sort({ animalType: 1 });
    res.json(tariffs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public: get active tariffs (for rate display)
router.get('/tariffs/active', async (req, res) => {
  try {
    const tariffs = await MCSTariff.find({ isActive: true });
    res.json(tariffs);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/tariffs', auth, async (req, res) => {
  try {
    const { animalType, rateType, flatRate, fatRates } = req.body;
    // Deactivate existing active tariff for this animalType
    await MCSTariff.updateMany({ animalType, isActive: true }, { isActive: false });
    const tariff = new MCSTariff({ animalType, rateType, flatRate, fatRates, updatedAt: new Date() });
    await tariff.save();
    res.status(201).json(tariff);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS  (admin)
// ─────────────────────────────────────────────────────────────────────────────

// GET all collections for a date (or date range)
// GET /api/mcs/collections?date=YYYY-MM-DD   or  ?month=YYYY-MM   or  ?customerId=...
router.get('/collections', auth, async (req, res) => {
  try {
    const { date, month, customerId } = req.query;
    const filter = {};
    if (date)   filter.date = date;
    else if (month) filter.date = { $regex: `^${month}` };
    if (customerId) {
      const c = await MCSCustomer.findOne({ customerId: customerId.toUpperCase() });
      if (c) filter.customer = c._id;
    }
    const collections = await MCSCollection.find(filter)
      .populate('customer', 'name customerId animalType')
      .sort({ date: -1, shift: 1, createdAt: -1 });
    res.json(collections);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// POST new collection entry
router.post('/collections', auth, async (req, res) => {
  try {
    let { customerId, date, shift, animalType, qty, fat, snf, ratePerLitre, note } = req.body;
    if (!customerId || !date || !shift || !qty) {
      return res.status(400).json({ message: 'customerId, date, shift और qty आवश्यक हैं' });
    }
    qty = parseFloat(qty);
    fat = parseFloat(fat) || 0;
    snf = parseFloat(snf) || 0;

    const customer = await MCSCustomer.findOne({ customerId: customerId.toUpperCase() });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });

    const effectiveAnimalType = animalType || customer.animalType;

    // Auto-calculate rate if not provided
    if (!ratePerLitre) {
      ratePerLitre = await getRate(effectiveAnimalType === 'both' ? 'buffalo' : effectiveAnimalType, fat);
    }
    ratePerLitre = parseFloat(ratePerLitre) || 0;
    const amount = parseFloat((qty * ratePerLitre).toFixed(2));

    const entry = new MCSCollection({
      customer: customer._id, date, shift,
      animalType: effectiveAnimalType === 'both' ? 'buffalo' : effectiveAnimalType,
      qty, fat, snf, ratePerLitre, amount, note
    });
    await entry.save();
    await entry.populate('customer', 'name customerId animalType');
    res.status(201).json(entry);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'इस ग्राहक की इस तारीख और पारी की एंट्री पहले से है' });
    res.status(500).json({ message: err.message });
  }
});

// PUT update collection
router.put('/collections/:id', auth, async (req, res) => {
  try {
    let { qty, fat, snf, ratePerLitre, note } = req.body;
    qty = parseFloat(qty);
    fat = parseFloat(fat) || 0;
    snf = parseFloat(snf) || 0;
    ratePerLitre = parseFloat(ratePerLitre) || 0;
    const amount = parseFloat((qty * ratePerLitre).toFixed(2));
    const entry = await MCSCollection.findByIdAndUpdate(
      req.params.id,
      { qty, fat, snf, ratePerLitre, amount, note },
      { new: true }
    ).populate('customer', 'name customerId animalType');
    if (!entry) return res.status(404).json({ message: 'एंट्री नहीं मिली' });
    res.json(entry);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// DELETE collection entry
router.delete('/collections/:id', auth, async (req, res) => {
  try {
    const entry = await MCSCollection.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ message: 'एंट्री नहीं मिली' });
    res.json({ message: 'एंट्री हटाई गई' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENTS  (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/payments', auth, async (req, res) => {
  try {
    const { month, customerId } = req.query;
    const filter = {};
    if (month) filter.period = month;
    if (customerId) {
      const c = await MCSCustomer.findOne({ customerId: customerId.toUpperCase() });
      if (c) filter.customer = c._id;
    }
    const payments = await MCSPayment.find(filter)
      .populate('customer', 'name customerId')
      .sort({ paymentDate: -1 });
    res.json(payments);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/payments', auth, async (req, res) => {
  try {
    const { customerId, amount, period, paymentDate, method, note } = req.body;
    if (!customerId || !amount || !paymentDate) {
      return res.status(400).json({ message: 'customerId, amount और paymentDate आवश्यक हैं' });
    }
    const customer = await MCSCustomer.findOne({ customerId: customerId.toUpperCase() });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });

    const payment = new MCSPayment({ customer: customer._id, amount: parseFloat(amount), period, paymentDate, method, note });
    await payment.save();
    await payment.populate('customer', 'name customerId');
    res.status(201).json(payment);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/payments/:id', auth, async (req, res) => {
  try {
    const p = await MCSPayment.findByIdAndDelete(req.params.id);
    if (!p) return res.status(404).json({ message: 'भुगतान नहीं मिला' });
    res.json({ message: 'भुगतान रिकॉर्ड हटाया गया' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY BILL / REPORT  (admin + customer)
// GET /api/mcs/bill/:customerId?month=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────
router.get('/bill/:customerId', async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const customer = await MCSCustomer.findOne({ customerId: req.params.customerId.toUpperCase() });
    if (!customer) return res.status(404).json({ message: 'ग्राहक नहीं मिला' });

    const [collections, payments] = await Promise.all([
      MCSCollection.find({ customer: customer._id, date: { $regex: `^${month}` } }).sort({ date: 1, shift: 1 }),
      MCSPayment.find({ customer: customer._id, period: month }).sort({ paymentDate: 1 })
    ]);

    const morningEntries = collections.filter(c => c.shift === 'morning');
    const eveningEntries = collections.filter(c => c.shift === 'evening');

    const totalLitres   = collections.reduce((s, c) => s + c.qty, 0);
    const totalAmount   = collections.reduce((s, c) => s + c.amount, 0);
    const avgFat        = collections.length ? (collections.reduce((s, c) => s + c.fat, 0) / collections.length) : 0;
    const morningLitres = morningEntries.reduce((s, c) => s + c.qty, 0);
    const eveningLitres = eveningEntries.reduce((s, c) => s + c.qty, 0);
    const totalPaid     = payments.reduce((s, p) => s + p.amount, 0);
    const due           = parseFloat((totalAmount - totalPaid).toFixed(2));

    const obj = customer.toObject();
    delete obj.pin;

    res.json({
      customer: obj, month, collections, payments,
      summary: { totalLitres, totalAmount, avgFat, morningLitres, eveningLitres, totalPaid, due }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY REPORT — all customers summary for a month  (admin)
// GET /api/mcs/report?month=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────
router.get('/report', auth, async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [customers, collections, payments] = await Promise.all([
      MCSCustomer.find({ isActive: true }).sort({ customerId: 1 }),
      MCSCollection.find({ date: { $regex: `^${month}` } }),
      MCSPayment.find({ period: month })
    ]);

    const report = customers.map(c => {
      const cCollections = collections.filter(e => String(e.customer) === String(c._id));
      const cPayments    = payments.filter(p => String(p.customer) === String(c._id));
      const litres  = cCollections.reduce((s, e) => s + e.qty, 0);
      const amount  = cCollections.reduce((s, e) => s + e.amount, 0);
      const paid    = cPayments.reduce((s, p) => s + p.amount, 0);
      const obj     = c.toObject();
      delete obj.pin;
      return { customer: obj, litres, amount, paid, due: parseFloat((amount - paid).toFixed(2)) };
    });

    const grandTotal = {
      litres:  report.reduce((s, r) => s + r.litres, 0),
      amount:  report.reduce((s, r) => s + r.amount, 0),
      paid:    report.reduce((s, r) => s + r.paid, 0),
      due:     report.reduce((s, r) => s + r.due, 0)
    };

    res.json({ month, report, grandTotal });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
