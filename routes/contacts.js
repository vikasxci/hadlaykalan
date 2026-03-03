const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// Get all approved contacts
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;
    const filter = { isApproved: true };
    if (role && role !== 'all') filter.role = role;
    const contacts = await Contact.find(filter).sort({ isImportant: -1, name: 1 });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get all contacts (admin)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const contacts = await Contact.find().sort({ isApproved: 1, createdAt: -1 });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Submit contact (public - needs approval)
router.post('/submit', upload.single('image'), async (req, res) => {
  try {
    const contactData = {
      name: req.body.name,
      phone: req.body.phone,
      role: req.body.role,
      address: req.body.address,
      description: req.body.description,
      isApproved: false
    };
    if (req.file) {
      contactData.image = req.file.path;
      contactData.cloudinaryId = req.file.filename;
    }
    const contact = new Contact(contactData);
    await contact.save();
    res.status(201).json({ message: 'Contact submitted for approval' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create contact (admin - auto approved)
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const contactData = {
      name: req.body.name,
      phone: req.body.phone,
      role: req.body.role,
      address: req.body.address,
      description: req.body.description,
      isApproved: true,
      isImportant: req.body.isImportant === 'true'
    };
    if (req.file) {
      contactData.image = req.file.path;
      contactData.cloudinaryId = req.file.filename;
    }
    const contact = new Contact(contactData);
    await contact.save();
    res.status(201).json(contact);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approve contact
router.put('/approve/:id', auth, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndUpdate(req.params.id, { isApproved: true }, { new: true });
    res.json(contact);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update contact
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });

    if (req.file) {
      if (contact.cloudinaryId) await cloudinary.uploader.destroy(contact.cloudinaryId);
      contact.image = req.file.path;
      contact.cloudinaryId = req.file.filename;
    }

    contact.name = req.body.name || contact.name;
    contact.phone = req.body.phone || contact.phone;
    contact.role = req.body.role || contact.role;
    contact.address = req.body.address || contact.address;
    contact.description = req.body.description || contact.description;
    contact.isImportant = req.body.isImportant !== undefined ? req.body.isImportant === 'true' : contact.isImportant;

    await contact.save();
    res.json(contact);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete contact
router.delete('/:id', auth, async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) return res.status(404).json({ message: 'Contact not found' });
    if (contact.cloudinaryId) await cloudinary.uploader.destroy(contact.cloudinaryId);
    await contact.deleteOne();
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
