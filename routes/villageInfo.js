const express = require('express');
const router = express.Router();
const VillageInfo = require('../models/VillageInfo');
const auth = require('../middleware/auth');

// Get all info
router.get('/', async (req, res) => {
  try {
    const infos = await VillageInfo.find();
    const result = {};
    infos.forEach(i => { result[i.key] = i.value; });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update info
router.put('/:key', auth, async (req, res) => {
  try {
    const info = await VillageInfo.findOneAndUpdate(
      { key: req.params.key },
      { value: req.body.value, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json(info);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
