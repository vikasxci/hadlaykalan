const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;

// GET all approved posts (public)
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find({ isApproved: true }).sort({ createdAt: -1 });
    const sanitized = posts.map(p => {
      const obj = p.toObject();
      delete obj.likedIPs;
      delete obj.editToken;
      return obj;
    });
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET single post by ID (public)
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const obj = post.toObject();
    delete obj.likedIPs;
    delete obj.editToken;
    res.json(obj);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create a new post (public - anyone can post)
// Accepts profilePic (avatar) and postImage (main post image)
router.post('/', upload.fields([
  { name: 'profilePic', maxCount: 1 },
  { name: 'postImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, title, content } = req.body;
    if (!name || !title || !content) {
      return res.status(400).json({ message: 'Name, title and content are required' });
    }

    // Generate unique edit token for user to edit their post later
    const editToken = crypto.randomBytes(32).toString('hex');

    const postData = {
      name: name.trim(),
      title: title.trim(),
      content: content.trim(),
      editToken
    };

    if (req.files && req.files.profilePic && req.files.profilePic[0]) {
      postData.profilePic = req.files.profilePic[0].path;
      postData.profilePicCloudinaryId = req.files.profilePic[0].filename;
    }

    if (req.files && req.files.postImage && req.files.postImage[0]) {
      postData.postImage = req.files.postImage[0].path;
      postData.postImageCloudinaryId = req.files.postImage[0].filename;
    }

    const post = new Post(postData);
    await post.save();

    // Return editToken so user can store it for later editing
    const result = post.toObject();
    delete result.likedIPs;
    result.editToken = editToken;
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST like a post (by IP)
router.post('/:id/like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
    const clientIP = ip.split(',')[0].trim();

    if (post.likedIPs.includes(clientIP)) {
      // Unlike
      post.likedIPs = post.likedIPs.filter(i => i !== clientIP);
      post.likes = Math.max(0, post.likes - 1);
      await post.save();
      return res.json({ likes: post.likes, liked: false });
    }

    // Like
    post.likedIPs.push(clientIP);
    post.likes += 1;
    await post.save();
    res.json({ likes: post.likes, liked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET check if IP has liked a post
router.get('/:id/check-like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
    const clientIP = ip.split(',')[0].trim();

    res.json({ liked: post.likedIPs.includes(clientIP) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ USER EDIT ROUTE ============

// PUT edit post by user (using editToken)
router.put('/:id/user-edit', upload.fields([
  { name: 'postImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const { editToken, title, content } = req.body;
    if (!editToken || post.editToken !== editToken) {
      return res.status(403).json({ message: 'Invalid edit token' });
    }

    if (title) post.title = title.trim();
    if (content) post.content = content.trim();

    // Handle new postImage upload
    if (req.files && req.files.postImage && req.files.postImage[0]) {
      // Delete old postImage from Cloudinary
      if (post.postImageCloudinaryId) {
        try { await cloudinary.uploader.destroy(post.postImageCloudinaryId); } catch(e) {}
      }
      post.postImage = req.files.postImage[0].path;
      post.postImageCloudinaryId = req.files.postImage[0].filename;
    }

    await post.save();
    const result = post.toObject();
    delete result.likedIPs;
    delete result.editToken;
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ============ ADMIN ROUTES ============

// GET all posts (admin)
router.get('/admin/all', auth, async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE post (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (post.profilePicCloudinaryId) {
      try { await cloudinary.uploader.destroy(post.profilePicCloudinaryId); } catch(e) {}
    }
    if (post.postImageCloudinaryId) {
      try { await cloudinary.uploader.destroy(post.postImageCloudinaryId); } catch(e) {}
    }

    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: 'Post deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT edit post (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const { name, title, content } = req.body;
    if (name) post.name = name.trim();
    if (title) post.title = title.trim();
    if (content) post.content = content.trim();

    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT toggle approval (admin)
router.put('/:id/toggle-approval', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    post.isApproved = !post.isApproved;
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
