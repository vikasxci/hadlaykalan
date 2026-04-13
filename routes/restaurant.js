const express  = require('express');
const router   = express.Router();
const jwt      = require('jsonwebtoken');

const restaurantAuth           = require('../middleware/restaurantAuth');
const { requireRole, requirePerm } = restaurantAuth;

const RestaurantBusiness    = require('../models/RestaurantBusiness');
const RestaurantStaff       = require('../models/RestaurantStaff');
const RestaurantTable       = require('../models/RestaurantTable');
const RestaurantMenuItem    = require('../models/RestaurantMenuItem');
const RestaurantRecipe      = require('../models/RestaurantRecipe');
const RestaurantOrder       = require('../models/RestaurantOrder');
const RestaurantKOT         = require('../models/RestaurantKOT');
const RestaurantModifier    = require('../models/RestaurantModifier');
const RestaurantReservation = require('../models/RestaurantReservation');
const RestaurantCustomer    = require('../models/RestaurantCustomer');
const InventoryItem         = require('../models/InventoryItem');
const InventoryStockTransaction = require('../models/InventoryStockTransaction');

const JWT_SECRET = process.env.JWT_SECRET || 'hadlay-kalan-secret-key';

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeToken(staffId, restaurantId, role) {
  return jwt.sign({ staffId, restaurantId, role }, JWT_SECRET, { expiresIn: '30d' });
}
function slugify(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-').substring(0,50);
}
async function nextOrderNumber(rId) {
  const n = await RestaurantOrder.countDocuments({ restaurant: rId });
  return `ORD-${String(n+1).padStart(4,'0')}`;
}
async function nextKOTNumber(rId) {
  const n = await RestaurantKOT.countDocuments({ restaurant: rId });
  return `KOT-${String(n+1).padStart(4,'0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════════════════

// POST /api/restaurant/auth/register
router.post('/auth/register', async (req, res) => {
  try {
    const { ownerName, businessName, email, phone, password, city, businessType, gstin, fssaiNo } = req.body;
    if (!ownerName||!businessName||!email||!phone||!password)
      return res.status(400).json({ message: 'ownerName, businessName, email, phone and password are required.' });
    const existing = await RestaurantBusiness.findOne({ $or:[{email:email.toLowerCase()},{phone:phone.trim()}] });
    if (existing) return res.status(409).json({ message: 'Email or phone already registered.' });
    let base=slugify(businessName), slug=base, n=1;
    while(await RestaurantBusiness.findOne({slug})) slug=`${base}-${n++}`;
    const restaurant = await RestaurantBusiness.create({
      businessName:businessName.trim(), ownerName:ownerName.trim(),
      email:email.toLowerCase().trim(), phone:phone.trim(), password, slug,
      businessType:businessType||'restaurant', gstin, fssaiNo, 'address.city':city||''
    });
    const owner = await RestaurantStaff.create({
      restaurant:restaurant._id, name:ownerName.trim(),
      email:email.toLowerCase().trim(), phone:phone.trim(), password, role:'owner'
    });
    const token = makeToken(owner._id, restaurant._id, 'owner');
    owner.token=token; await owner.save({validateBeforeSave:false});
    restaurant.token=token; await restaurant.save({validateBeforeSave:false});
    res.status(201).json({ message:'Restaurant registered.', token, staff:owner.toSafeObject(), restaurant:restaurant.toSafeObject() });
  } catch(err) {
    if(err.code===11000) return res.status(409).json({ message:'Email or phone already registered.' });
    res.status(500).json({ message:err.message });
  }
});

// POST /api/restaurant/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { emailOrPhone, password, restaurantId } = req.body;
    if (!emailOrPhone||!password) return res.status(400).json({ message:'Email/phone and password required.' });
    const q = restaurantId
      ? { restaurant:restaurantId, $or:[{email:emailOrPhone.toLowerCase()},{phone:emailOrPhone}] }
      : { $or:[{email:emailOrPhone.toLowerCase()},{phone:emailOrPhone}] };
    const staff = await RestaurantStaff.findOne(q);
    if (!staff||!staff.password) return res.status(401).json({ message:'Invalid credentials.' });
    if (!await staff.comparePassword(password)) return res.status(401).json({ message:'Invalid credentials.' });
    if (!staff.isActive) return res.status(403).json({ message:'Account deactivated.' });
    const restaurant = await RestaurantBusiness.findById(staff.restaurant);
    if (!restaurant||!restaurant.isActive) return res.status(403).json({ message:'Restaurant inactive.' });
    const token = makeToken(staff._id, restaurant._id, staff.role);
    staff.token=token; staff.lastLoginAt=new Date(); staff.loginCount=(staff.loginCount||0)+1;
    await staff.save({validateBeforeSave:false});
    res.json({ token, staff:staff.toSafeObject(), restaurant:restaurant.toSafeObject() });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// POST /api/restaurant/auth/pin-login
router.post('/auth/pin-login', async (req, res) => {
  try {
    const { restaurantId, pin } = req.body;
    if (!restaurantId||!pin) return res.status(400).json({ message:'restaurantId and pin required.' });
    const staffList = await RestaurantStaff.find({ restaurant:restaurantId, isActive:true, pin:{$exists:true,$ne:null} });
    let matched=null;
    for(const s of staffList) { if(s.pin && await s.comparePin(pin)){matched=s;break;} }
    if (!matched) return res.status(401).json({ message:'Invalid PIN.' });
    const restaurant = await RestaurantBusiness.findById(restaurantId);
    if (!restaurant||!restaurant.isActive) return res.status(403).json({ message:'Restaurant inactive.' });
    const token = makeToken(matched._id, restaurant._id, matched.role);
    matched.token=token; matched.lastLoginAt=new Date();
    await matched.save({validateBeforeSave:false});
    res.json({ token, staff:matched.toSafeObject(), restaurant:restaurant.toSafeObject() });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// GET /api/restaurant/auth/me
router.get('/auth/me', restaurantAuth, (req, res) => res.json({ staff:req.staff, restaurant:req.restaurant }));

// POST /api/restaurant/auth/logout
router.post('/auth/logout', restaurantAuth, async (req, res) => {
  await RestaurantStaff.findByIdAndUpdate(req.staff._id, { token:null });
  res.json({ message:'Logged out.' });
});

// ════════════════════════════════════════════════════════════════════════════
// STAFF MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

router.get('/staff', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const list = await RestaurantStaff.find({ restaurant:req.restaurant._id }).select('-password -pin -token').sort({role:1,name:1});
    res.json(list);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/staff', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const { name, email, phone, password, pin, role, designation, salary, joiningDate } = req.body;
    if (!name||!role) return res.status(400).json({ message:'name and role are required.' });
    if (req.staff.role==='manager'&&role==='owner') return res.status(403).json({ message:'Managers cannot create owner accounts.' });
    const m = await RestaurantStaff.create({ restaurant:req.restaurant._id, name, email, phone, password, pin, role, designation, salary, joiningDate });
    res.status(201).json(m.toSafeObject());
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/staff/:id', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const m = await RestaurantStaff.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!m) return res.status(404).json({ message:'Staff not found.' });
    ['name','email','phone','role','designation'].forEach(k=>{ if(req.body[k]!==undefined) m[k]=req.body[k]; });
    if (req.body.salary!==undefined) m.salary=req.body.salary;
    if (req.body.isActive!==undefined) m.isActive=req.body.isActive;
    if (req.body.password) m.password=req.body.password;
    if (req.body.pin) m.pin=req.body.pin;
    if (req.body.permissions) Object.assign(m.permissions, req.body.permissions);
    await m.save();
    res.json(m.toSafeObject());
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/staff/:id', restaurantAuth, requireRole('owner'), async (req, res) => {
  try {
    const m = await RestaurantStaff.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!m) return res.status(404).json({ message:'Staff not found.' });
    if (m.role==='owner') return res.status(400).json({ message:'Cannot delete owner.' });
    await m.deleteOne();
    res.json({ message:'Staff removed.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════

router.get('/settings', restaurantAuth, (req, res) => res.json(req.restaurant));

router.put('/settings', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const allowed=['businessName','ownerName','phone','gstin','fssaiNo','address','cuisine','hours','settings','features','logo','coverImage','businessType'];
    const update={};
    allowed.forEach(k=>{ if(req.body[k]!==undefined) update[k]=req.body[k]; });
    const biz = await RestaurantBusiness.findByIdAndUpdate(req.restaurant._id,{$set:update},{new:true,runValidators:true}).select('-password -token');
    res.json(biz);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// TABLES
// ════════════════════════════════════════════════════════════════════════════

router.get('/tables', restaurantAuth, async (req, res) => {
  try {
    const tables = await RestaurantTable.find({ restaurant:req.restaurant._id, isActive:true })
      .populate('currentOrder','orderNumber status items grandTotal waiterName')
      .sort({ area:1, tableNo:1 });
    res.json(tables);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/tables', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const { tableNo, area, seats, notes } = req.body;
    if (!tableNo) return res.status(400).json({ message:'tableNo is required.' });
    const t = await RestaurantTable.create({ restaurant:req.restaurant._id, tableNo, area, seats, notes });
    res.status(201).json(t);
  } catch(err) {
    if(err.code===11000) return res.status(409).json({ message:'Table number already exists.' });
    res.status(500).json({ message:err.message });
  }
});

router.put('/tables/:id', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const t = await RestaurantTable.findOneAndUpdate(
      { _id:req.params.id, restaurant:req.restaurant._id }, {$set:req.body}, {new:true,runValidators:true}
    );
    if (!t) return res.status(404).json({ message:'Table not found.' });
    res.json(t);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/tables/:id/status', restaurantAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const update = { status };
    if (status==='available') update.currentOrder=null;
    const t = await RestaurantTable.findOneAndUpdate({ _id:req.params.id, restaurant:req.restaurant._id }, update, {new:true});
    if (!t) return res.status(404).json({ message:'Table not found.' });
    res.json(t);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/tables/:id', restaurantAuth, requireRole('owner','manager'), async (req, res) => {
  try {
    const t = await RestaurantTable.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!t) return res.status(404).json({ message:'Table not found.' });
    if (t.status==='occupied') return res.status(400).json({ message:'Cannot delete occupied table.' });
    await t.deleteOne();
    res.json({ message:'Table deleted.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// MENU
// ════════════════════════════════════════════════════════════════════════════

router.get('/menu', restaurantAuth, async (req, res) => {
  try {
    const { category, type, available } = req.query;
    const q = { restaurant:req.restaurant._id, isActive:true };
    if (category) q.category=category;
    if (type) q.type=type;
    if (available==='true') q.isAvailable=true;
    if (available==='false') q.isAvailable=false;
    const items = await RestaurantMenuItem.find(q)
      .populate('modifierGroups','groupName type required options')
      .sort({ category:1, sortOrder:1, name:1 });
    res.json(items);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.get('/menu/categories', restaurantAuth, async (req, res) => {
  try {
    const cats = await RestaurantMenuItem.distinct('category',{ restaurant:req.restaurant._id, isActive:true });
    res.json(cats.sort());
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/menu', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const { name, description, category, type, price, variants, taxRate, taxIncluded,
            preparationTime, allergens, tags, sortOrder, kitchenStation, modifierGroups } = req.body;
    if (!name||!category||price===undefined) return res.status(400).json({ message:'name, category and price are required.' });
    const item = await RestaurantMenuItem.create({
      restaurant:req.restaurant._id, name, description, category, type, price,
      variants:variants||[], taxRate, taxIncluded, preparationTime,
      allergens:allergens||[], tags:tags||[], sortOrder:sortOrder||0, kitchenStation, modifierGroups:modifierGroups||[]
    });
    res.status(201).json(item);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/menu/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const allowed=['name','description','category','type','price','variants','taxRate','taxIncluded',
                   'preparationTime','allergens','tags','sortOrder','isAvailable','isActive','kitchenStation','modifierGroups'];
    const update={};
    allowed.forEach(k=>{ if(req.body[k]!==undefined) update[k]=req.body[k]; });
    const item = await RestaurantMenuItem.findOneAndUpdate(
      { _id:req.params.id, restaurant:req.restaurant._id }, update, {new:true,runValidators:true}
    );
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    res.json(item);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/menu/:id/toggle', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const item = await RestaurantMenuItem.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    item.isAvailable=!item.isAvailable; await item.save();
    res.json({ isAvailable:item.isAvailable });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/menu/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const item = await RestaurantMenuItem.findOneAndDelete({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    await RestaurantRecipe.deleteOne({ menuItem:req.params.id, restaurant:req.restaurant._id });
    res.json({ message:'Menu item deleted.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// Aliases: /menu/items mirrors /menu  (frontend uses /menu/items pattern)
router.get('/menu/items', restaurantAuth, async (req, res) => {
  try {
    const { category, type, available } = req.query;
    const q = { restaurant:req.restaurant._id, isActive:true };
    if (category) q.category = category;
    if (type) q.type = type;
    if (available === 'true') q.isAvailable = true;
    if (available === 'false') q.isAvailable = false;
    const items = await RestaurantMenuItem.find(q)
      .populate('modifierGroups', 'groupName type required options')
      .sort({ category:1, sortOrder:1, name:1 });
    res.json(items);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/menu/items', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const { name, description, category, type, price, variants, taxRate, taxIncluded,
            preparationTime, allergens, tags, sortOrder, kitchenStation, modifierGroups } = req.body;
    if (!name || !category || price === undefined) return res.status(400).json({ message:'name, category and price are required.' });
    const item = await RestaurantMenuItem.create({
      restaurant:req.restaurant._id, name, description, category, type, price,
      variants:variants||[], taxRate, taxIncluded, preparationTime,
      allergens:allergens||[], tags:tags||[], sortOrder:sortOrder||0, kitchenStation, modifierGroups:modifierGroups||[]
    });
    res.status(201).json(item);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/menu/items/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const allowed = ['name','description','category','type','price','variants','taxRate','taxIncluded',
                     'preparationTime','allergens','tags','sortOrder','isAvailable','isActive','kitchenStation','modifierGroups'];
    const update = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const item = await RestaurantMenuItem.findOneAndUpdate(
      { _id:req.params.id, restaurant:req.restaurant._id }, update, { new:true, runValidators:true }
    );
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    res.json(item);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/menu/items/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const item = await RestaurantMenuItem.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    if (req.body.isAvailable !== undefined) {
      item.isAvailable = req.body.isAvailable;
    } else {
      item.isAvailable = !item.isAvailable; // toggle if no value sent
    }
    await item.save();
    res.json(item);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/menu/items/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const item = await RestaurantMenuItem.findOneAndDelete({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!item) return res.status(404).json({ message:'Menu item not found.' });
    await RestaurantRecipe.deleteOne({ menuItem:req.params.id, restaurant:req.restaurant._id });
    res.json({ message:'Menu item deleted.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// MODIFIERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/modifiers', restaurantAuth, async (req, res) => {
  try {
    res.json(await RestaurantModifier.find({ restaurant:req.restaurant._id, isActive:true }).sort({sortOrder:1}));
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/modifiers', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const { groupName, type, required, minSelect, maxSelect, options, appliesTo, appliesToCategories, sortOrder } = req.body;
    if (!groupName||!options?.length) return res.status(400).json({ message:'groupName and options required.' });
    const mod = await RestaurantModifier.create({ restaurant:req.restaurant._id, groupName, type, required, minSelect, maxSelect, options, appliesTo, appliesToCategories, sortOrder });
    res.status(201).json(mod);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/modifiers/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const mod = await RestaurantModifier.findOneAndUpdate(
      { _id:req.params.id, restaurant:req.restaurant._id }, {$set:req.body}, {new:true,runValidators:true}
    );
    if (!mod) return res.status(404).json({ message:'Modifier not found.' });
    res.json(mod);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/modifiers/:id', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const mod = await RestaurantModifier.findOneAndDelete({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!mod) return res.status(404).json({ message:'Modifier not found.' });
    res.json({ message:'Modifier deleted.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// RECIPES
// ════════════════════════════════════════════════════════════════════════════

router.get('/recipe/:menuItemId', restaurantAuth, async (req, res) => {
  try {
    res.json(await RestaurantRecipe.findOne({ menuItem:req.params.menuItemId, restaurant:req.restaurant._id }) || null);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/recipe/:menuItemId', restaurantAuth, requirePerm('editMenu'), async (req, res) => {
  try {
    const { servings, ingredients, instructions, notes } = req.body;
    const enriched=[]; let totalCost=0;
    for(const ing of (ingredients||[])) {
      let costPerUnit=ing.costPerUnit||0;
      if(ing.item) { const ii=await InventoryItem.findById(ing.item).select('costPrice').lean(); if(ii) costPerUnit=ii.costPrice||0; }
      const qty=Number(ing.quantity)||0, waste=1+((Number(ing.wastagePercent)||0)/100), line=qty*costPerUnit*waste;
      totalCost+=line; enriched.push({...ing,costPerUnit,totalCost:line});
    }
    const recipe = await RestaurantRecipe.findOneAndUpdate(
      { menuItem:req.params.menuItemId, restaurant:req.restaurant._id },
      { restaurant:req.restaurant._id, menuItem:req.params.menuItemId, servings:servings||1, ingredients:enriched, totalCost, instructions, notes },
      { upsert:true, new:true, runValidators:true }
    );
    const perServing=(servings||1)>0?totalCost/(servings||1):totalCost;
    await RestaurantMenuItem.findOneAndUpdate({ _id:req.params.menuItemId, restaurant:req.restaurant._id },{ costPrice:perServing });
    res.json(recipe);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/orders', restaurantAuth, async (req, res) => {
  try {
    const { status, date, page=1, limit=50 } = req.query;
    const q={ restaurant:req.restaurant._id };
    if(status) q.status={ $in:status.split(',').map(s=>s.trim()) };
    if(date){ const d=new Date(date), next=new Date(d); next.setDate(next.getDate()+1); q.createdAt={$gte:d,$lt:next}; }
    const [orders,total]=await Promise.all([
      RestaurantOrder.find(q).populate('waiter','name role').sort({createdAt:-1}).skip((+page-1)*+limit).limit(+limit).lean(),
      RestaurantOrder.countDocuments(q)
    ]);
    res.json({ orders, total, page:+page, pages:Math.ceil(total/+limit) });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.get('/orders/:id', restaurantAuth, async (req, res) => {
  try {
    const order=await RestaurantOrder.findOne({ _id:req.params.id, restaurant:req.restaurant._id })
      .populate('waiter','name role').populate('cashier','name role').populate('kots');
    if (!order) return res.status(404).json({ message:'Order not found.' });
    res.json(order);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/orders', restaurantAuth, requirePerm('createOrder'), async (req, res) => {
  try {
    const { type, tableId, customerName, customerPhone, deliveryAddress, persons, items, notes } = req.body;
    if (!items?.length) return res.status(400).json({ message:'At least one item is required.' });
    const orderNumber=await nextOrderNumber(req.restaurant._id);
    let tableNo, area;
    if(type==='dine-in'&&tableId) {
      const t=await RestaurantTable.findOne({ _id:tableId, restaurant:req.restaurant._id });
      if(!t) return res.status(404).json({ message:'Table not found.' });
      if(t.status==='occupied') return res.status(409).json({ message:`${t.tableNo} is occupied.` });
      tableNo=t.tableNo; area=t.area;
      await RestaurantTable.findByIdAndUpdate(tableId,{status:'occupied'});
    }
    const now=new Date();
    const orderItems=items.map(i=>({
      menuItem:i.menuItemId||undefined, name:i.name, category:i.category||'', variant:i.variant||'',
      qty:Number(i.qty)||1, price:Number(i.price)||0, taxRate:Number(i.taxRate)||0,
      modifiers:i.modifiers||[], notes:i.notes||'', station:i.station||'Main Kitchen', status:'pending', sentAt:now
    }));
    const subtotal=orderItems.reduce((s,i)=>s+i.qty*(i.price+(i.modifiers||[]).reduce((m,mod)=>m+(mod.price||0),0)),0);
    let customerId;
    if(customerPhone) {
      const cust=await RestaurantCustomer.findOne({ restaurant:req.restaurant._id, phone:customerPhone });
      if(cust) customerId=cust._id;
    }
    const order=await RestaurantOrder.create({
      restaurant:req.restaurant._id, orderNumber, type:type||'dine-in',
      table:tableId||undefined, tableNo, area, customer:customerId,
      customerName, customerPhone, deliveryAddress,
      waiter:req.staff._id, waiterName:req.staff.name,
      persons:Number(persons)||1, items:orderItems, status:'open', kotSentAt:now, subtotal, notes
    });
    const kotNumber=await nextKOTNumber(req.restaurant._id);
    const kot=await RestaurantKOT.create({
      restaurant:req.restaurant._id, order:order._id, kotNumber,
      tableNo, area, type:type||'dine-in', waiter:req.staff._id, waiterName:req.staff.name,
      items:orderItems.map(i=>({ menuItem:i.menuItem, name:i.name, variant:i.variant, qty:i.qty, modifiers:i.modifiers, notes:i.notes, station:i.station, status:'pending' })),
      kotType:'new', status:'pending'
    });
    order.kots.push(kot._id);
    if(tableId) await RestaurantTable.findByIdAndUpdate(tableId,{currentOrder:order._id});
    await order.save();
    res.status(201).json({ order, kot });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/orders/:id/items', restaurantAuth, requirePerm('editOrder'), async (req, res) => {
  try {
    const { items } = req.body;
    const order=await RestaurantOrder.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!order) return res.status(404).json({ message:'Order not found.' });
    if(['billed','cancelled'].includes(order.status)) return res.status(400).json({ message:'Cannot add items to closed order.' });
    const now=new Date();
    const newItems=items.map(i=>({ menuItem:i.menuItemId||undefined, name:i.name, category:i.category||'', variant:i.variant||'', qty:Number(i.qty)||1, price:Number(i.price)||0, taxRate:Number(i.taxRate)||0, modifiers:i.modifiers||[], notes:i.notes||'', station:i.station||'Main Kitchen', status:'pending', sentAt:now }));
    order.items.push(...newItems);
    order.subtotal=order.items.filter(i=>i.status!=='cancelled').reduce((s,i)=>s+i.qty*i.price,0);
    const kotNumber=await nextKOTNumber(req.restaurant._id);
    const kot=await RestaurantKOT.create({
      restaurant:req.restaurant._id, order:order._id, kotNumber, tableNo:order.tableNo, area:order.area, type:order.type,
      waiter:req.staff._id, waiterName:req.staff.name,
      items:newItems.map(i=>({ name:i.name, variant:i.variant, qty:i.qty, modifiers:i.modifiers, notes:i.notes, station:i.station, status:'pending' })),
      kotType:'add', status:'pending'
    });
    order.kots.push(kot._id); await order.save();
    res.json({ order, kot });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/orders/:id/item/:itemId/status', restaurantAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const order=await RestaurantOrder.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!order) return res.status(404).json({ message:'Order not found.' });
    const item=order.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message:'Item not found.' });
    item.status=status; if(status==='ready') item.readyAt=new Date();
    const active=order.items.filter(i=>i.status!=='cancelled');
    if(active.every(i=>i.status==='served')) order.status='ready';
    else if(active.some(i=>['preparing','ready'].includes(i.status))) order.status='preparing';
    await order.save();
    res.json({ itemStatus:status, orderStatus:order.status });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/orders/:id/status', restaurantAuth, async (req, res) => {
  try {
    const order=await RestaurantOrder.findOneAndUpdate(
      { _id:req.params.id, restaurant:req.restaurant._id }, {status:req.body.status}, {new:true}
    );
    if (!order) return res.status(404).json({ message:'Order not found.' });
    res.json(order);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/orders/:id/bill', restaurantAuth, requirePerm('billing'), async (req, res) => {
  try {
    const { serviceChargePercent=0, discountPercent=0, discountType='percent', discountFlat=0, amountPaid, paymentMethod } = req.body;
    const order=await RestaurantOrder.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!order) return res.status(404).json({ message:'Order not found.' });
    if (order.status==='billed') return res.status(400).json({ message:'Order already billed.' });
    if (order.status==='cancelled') return res.status(400).json({ message:'Order is cancelled.' });
    const biz=await RestaurantBusiness.findById(req.restaurant._id);
    const activeItems=order.items.filter(i=>i.status!=='cancelled');
    let subtotal=0, taxAmount=0;
    activeItems.forEach(i=>{
      const modExtra=(i.modifiers||[]).reduce((m,mod)=>m+(mod.price||0),0);
      const line=i.qty*(i.price+modExtra);
      subtotal+=line; taxAmount+=line*((i.taxRate||0)/100);
    });
    const svcPct=Number(serviceChargePercent)||(biz?.settings?.serviceCharge?.enabled?biz.settings.serviceCharge.percent:0);
    const svcAmt=subtotal*(svcPct/100);
    const discAmt=discountType==='flat'?Number(discountFlat):subtotal*(Number(discountPercent)/100);
    const rawTotal=subtotal+svcAmt-discAmt+taxAmount;
    const roundOff=Math.round(rawTotal)-rawTotal;
    const grandTotal=Math.round(rawTotal);
    const paid=Number(amountPaid)||0;
    Object.assign(order,{
      subtotal, taxAmount, serviceChargePercent:svcPct, serviceChargeAmount:svcAmt,
      discountPercent:Number(discountPercent), discountAmount:discAmt, discountType,
      roundOff, grandTotal, amountPaid:paid, amountDue:Math.max(0,grandTotal-paid),
      paymentStatus:paid>=grandTotal?'paid':paid>0?'partial':'unpaid',
      paymentMethod:paymentMethod||'cash', status:'billed', billedAt:new Date(), cashier:req.staff._id
    });
    // Deduct inventory
    for(const oi of activeItems){
      if(!oi.menuItem) continue;
      const recipe=await RestaurantRecipe.findOne({ menuItem:oi.menuItem, restaurant:req.restaurant._id });
      if(!recipe?.ingredients?.length) continue;
      for(const ing of recipe.ingredients){
        if(!ing.item) continue;
        const tq=ing.quantity*oi.qty*(1+(ing.wastagePercent||0)/100);
        const ii=await InventoryItem.findById(ing.item); if(!ii) continue;
        const bef=ii.currentStock, aft=bef-tq; ii.currentStock=aft; await ii.save();
        await InventoryStockTransaction.create({ business:biz._id, item:ii._id, itemName:ii.name, type:'sale', quantity:-tq, stockBefore:bef, stockAfter:aft, notes:`Auto: ${order.orderNumber} – ${oi.name}` });
      }
    }
    if(order.table) await RestaurantTable.findByIdAndUpdate(order.table,{status:'dirty',currentOrder:null});
    // Update customer
    let customer=null;
    const pts=Math.floor(grandTotal/10);
    if(order.customerPhone){
      customer=await RestaurantCustomer.findOneAndUpdate(
        { restaurant:req.restaurant._id, phone:order.customerPhone },
        { $setOnInsert:{ name:order.customerName||'Guest', firstVisitAt:new Date() }, $inc:{totalOrders:1,totalSpent:grandTotal,loyaltyPoints:pts,lifetimeLoyalty:pts}, $set:{lastVisitAt:new Date()} },
        { upsert:true, new:true }
      );
    }
    await order.save();
    // WhatsApp
    let whatsapp=null;
    if(order.customerPhone){
      const waPhone=`91${order.customerPhone.replace(/\D/g,'').slice(-10)}`;
      const itemList=activeItems.map(i=>`  • ${i.name}${i.variant?` (${i.variant})`:''} x${i.qty} = ₹${(i.qty*i.price).toFixed(0)}`).join('\n');
      const msg=[
        `🏮 *${biz.businessName}*`,`Thank you for dining! 🙏`,``,
        `📋 Order: ${order.orderNumber}`,
        order.tableNo?`🪑 Table: ${order.tableNo}`:`🥡 Type: ${order.type}`,``,
        `*Items:*`,itemList,``,
        `Subtotal: ₹${subtotal.toFixed(0)}`,
        svcAmt?`Service: ₹${svcAmt.toFixed(0)}`:'',discAmt?`Discount: -₹${discAmt.toFixed(0)}`:'',
        `Tax: ₹${taxAmount.toFixed(0)}`,`*Total: ₹${grandTotal}*`,`Payment: ${order.paymentMethod.toUpperCase()}`,
        customer?`\n🎁 Loyalty Points: +${pts} (Total: ${customer.loyaltyPoints})`:'',``,
        biz.settings?.billFooter||'Visit us again! 😊'
      ].filter(l=>l!=='').join('\n');
      whatsapp={ phone:waPhone, message:msg, url:`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}` };
    }
    res.json({ order, customer, whatsapp });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/orders/:id', restaurantAuth, requirePerm('cancelOrder'), async (req, res) => {
  try {
    const order=await RestaurantOrder.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!order) return res.status(404).json({ message:'Order not found.' });
    if (order.status==='billed') return res.status(400).json({ message:'Billed orders cannot be cancelled.' });
    order.status='cancelled'; await order.save();
    if(order.table) await RestaurantTable.findByIdAndUpdate(order.table,{status:'available',currentOrder:null});
    res.json({ message:'Order cancelled.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// KDS (Kitchen Display System)
// ════════════════════════════════════════════════════════════════════════════

router.get('/kds', restaurantAuth, async (req, res) => {
  try {
    const { station } = req.query;
    const kots=await RestaurantKOT.find({ restaurant:req.restaurant._id, status:{$in:['pending','preparing']} }).sort({createdAt:1}).lean();
    const filtered=kots.map(k=>({...k, items:k.items.filter(i=>['pending','preparing'].includes(i.status)&&(!station||i.station===station))})).filter(k=>k.items.length);
    res.json(filtered);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/kds/:kotId/items/:itemId', restaurantAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const kot=await RestaurantKOT.findOne({ _id:req.params.kotId, restaurant:req.restaurant._id });
    if (!kot) return res.status(404).json({ message:'KOT not found.' });
    const item=kot.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message:'Item not found in KOT.' });
    item.status=status; if(status==='ready') item.readyAt=new Date();
    if(kot.items.every(i=>i.status==='ready'||i.status==='cancelled')) { kot.status='ready'; kot.completedAt=new Date(); }
    else if(kot.items.some(i=>i.status==='preparing')) kot.status='preparing';
    await kot.save();
    res.json({ kotStatus:kot.status, itemStatus:status });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/kds/:kotId/ready', restaurantAuth, async (req, res) => {
  try {
    const kot=await RestaurantKOT.findOne({ _id:req.params.kotId, restaurant:req.restaurant._id });
    if (!kot) return res.status(404).json({ message:'KOT not found.' });
    kot.status='ready'; kot.completedAt=new Date(); kot.items.forEach(i=>{ if(i.status!=='cancelled') i.status='ready'; });
    await kot.save(); res.json(kot);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════════════════════

router.get('/customers', restaurantAuth, async (req, res) => {
  try {
    const { search, group, page=1, limit=50 } = req.query;
    const q={ restaurant:req.restaurant._id, isActive:true };
    if(group) q.group=group;
    if(search) q.$or=[{name:new RegExp(search,'i')},{phone:new RegExp(search,'i')}];
    const [customers,total]=await Promise.all([
      RestaurantCustomer.find(q).sort({totalSpent:-1}).skip((+page-1)*+limit).limit(+limit),
      RestaurantCustomer.countDocuments(q)
    ]);
    res.json({ customers, total, page:+page, pages:Math.ceil(total/+limit) });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.get('/customers/lookup', restaurantAuth, async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone||phone.length<6) return res.json(null);
    const c=await RestaurantCustomer.findOne({ restaurant:req.restaurant._id, phone:new RegExp(phone.slice(-6),'i') });
    res.json(c||null);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.get('/customers/:id', restaurantAuth, async (req, res) => {
  try {
    const c=await RestaurantCustomer.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!c) return res.status(404).json({ message:'Customer not found.' });
    const orders=await RestaurantOrder.find({ restaurant:req.restaurant._id, customerPhone:c.phone, status:'billed' }).sort({billedAt:-1}).limit(20).lean();
    res.json({ customer:c, recentOrders:orders });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.put('/customers/:id', restaurantAuth, async (req, res) => {
  try {
    const allowed=['name','email','birthdate','anniversary','group','tags','dietaryPrefs','notes','deliveryAddresses'];
    const update={}; allowed.forEach(k=>{ if(req.body[k]!==undefined) update[k]=req.body[k]; });
    const c=await RestaurantCustomer.findOneAndUpdate({ _id:req.params.id, restaurant:req.restaurant._id }, update, {new:true});
    if (!c) return res.status(404).json({ message:'Customer not found.' });
    res.json(c);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/customers/:id/redeem', restaurantAuth, requirePerm('applyDiscount'), async (req, res) => {
  try {
    const { points } = req.body;
    const c=await RestaurantCustomer.findOne({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!c) return res.status(404).json({ message:'Customer not found.' });
    if (c.loyaltyPoints<points) return res.status(400).json({ message:'Insufficient loyalty points.' });
    c.loyaltyPoints-=points; c.loyaltyRedeemed=(c.loyaltyRedeemed||0)+points; await c.save();
    res.json({ loyaltyPoints:c.loyaltyPoints, redeemed:points, cashValue:points });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// RESERVATIONS
// ════════════════════════════════════════════════════════════════════════════

router.get('/reservations', restaurantAuth, async (req, res) => {
  try {
    const { date, status } = req.query;
    const q={ restaurant:req.restaurant._id };
    if(status) q.status=status;
    if(date){ const d=new Date(date), next=new Date(d); next.setDate(next.getDate()+1); q.date={$gte:d,$lt:next}; }
    res.json(await RestaurantReservation.find(q).sort({date:1,time:1}).populate('table','tableNo area').populate('confirmedBy','name'));
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.post('/reservations', restaurantAuth, async (req, res) => {
  try {
    const { guestName, guestPhone, guestEmail, partySize, date, time, duration, tableId, area, occasion, notes, specialRequests } = req.body;
    if (!guestName||!guestPhone||!partySize||!date||!time) return res.status(400).json({ message:'guestName, guestPhone, partySize, date and time required.' });
    const r=await RestaurantReservation.create({ restaurant:req.restaurant._id, guestName, guestPhone, guestEmail, partySize, date:new Date(date), time, duration, table:tableId||undefined, area, occasion, notes, specialRequests, status:'pending' });
    res.status(201).json(r);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.patch('/reservations/:id/status', restaurantAuth, async (req, res) => {
  try {
    const { status, tableId } = req.body;
    const update={ status };
    if(status==='confirmed') update.confirmedBy=req.staff._id;
    if(status==='seated'){ update.seatedBy=req.staff._id; update.seatedAt=new Date(); }
    if(tableId) update.table=tableId;
    const r=await RestaurantReservation.findOneAndUpdate({ _id:req.params.id, restaurant:req.restaurant._id }, update, {new:true});
    if (!r) return res.status(404).json({ message:'Reservation not found.' });
    res.json(r);
  } catch(err) { res.status(500).json({ message:err.message }); }
});

router.delete('/reservations/:id', restaurantAuth, async (req, res) => {
  try {
    const r=await RestaurantReservation.findOneAndDelete({ _id:req.params.id, restaurant:req.restaurant._id });
    if (!r) return res.status(404).json({ message:'Reservation not found.' });
    res.json({ message:'Reservation deleted.' });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════════════════════════════════════════

router.get('/reports', restaurantAuth, requirePerm('viewReports'), async (req, res) => {
  try {
    const days=parseInt(req.query.days)||30;
    const since=new Date(); since.setDate(since.getDate()-days);
    const rId=req.restaurant._id;
    const [summary,daily,topDishes,typeBreakdown,paymentBreakdown,staffPerf]=await Promise.all([
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since}}},
        {$group:{_id:null,totalRevenue:{$sum:'$grandTotal'},totalOrders:{$sum:1},avgOrderValue:{$avg:'$grandTotal'},totalDiscount:{$sum:'$discountAmount'},totalTax:{$sum:'$taxAmount'}}}
      ]),
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since}}},
        {$group:{_id:{$dateToString:{format:'%Y-%m-%d',date:'$billedAt'}},revenue:{$sum:'$grandTotal'},orders:{$sum:1}}},
        {$sort:{_id:1}}
      ]),
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since}}},
        {$unwind:'$items'},{$match:{'items.status':{$ne:'cancelled'}}},
        {$group:{_id:{name:'$items.name',category:'$items.category'},qty:{$sum:'$items.qty'},revenue:{$sum:{$multiply:['$items.qty','$items.price']}}}},
        {$sort:{qty:-1}},{$limit:15}
      ]),
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since}}},
        {$group:{_id:'$type',revenue:{$sum:'$grandTotal'},count:{$sum:1}}}
      ]),
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since}}},
        {$group:{_id:'$paymentMethod',revenue:{$sum:'$grandTotal'},count:{$sum:1}}}
      ]),
      RestaurantOrder.aggregate([
        {$match:{restaurant:rId,status:'billed',billedAt:{$gte:since},waiter:{$exists:true}}},
        {$group:{_id:'$waiter',waiterName:{$first:'$waiterName'},orders:{$sum:1},revenue:{$sum:'$grandTotal'}}},
        {$sort:{orders:-1}},{$limit:10}
      ])
    ]);
    res.json({ stats:summary[0]||{totalRevenue:0,totalOrders:0,avgOrderValue:0}, dailyRevenue:daily, topDishes, typeBreakdown, paymentBreakdown, staffPerformance:staffPerf });
  } catch(err) { res.status(500).json({ message:err.message }); }
});

module.exports = router;
