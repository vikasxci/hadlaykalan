const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const upload = require('../middleware/upload');
const cloudinary = require('cloudinary').v2;
const AndroidDevice = require('../models/AndroidDevice');

function getFcmHelper() {
  return require('./androidDevices');
}

async function notifyNewPost(post) {
  try {
    const devices = await AndroidDevice.find(
      { fcmToken: { $exists: true, $ne: null } },
      'fcmToken'
    );
    const tokens = devices.map(d => d.fcmToken).filter(Boolean);
    if (!tokens.length) return;

    const helper = getFcmHelper();
    if (typeof helper.sendFcmMulticast !== 'function') return;

    const topicLabels = {
      issue: 'समस्या', good_work: 'अच्छा काम', announcement: 'घोषणा',
      feedback: 'प्रतिक्रिया', thanks: 'धन्यवाद', message: 'संदेश', lost_found: 'खोया-पाया', other: 'अन्य',
    };
    const topicLabel = topicLabels[post.topic] || 'पोस्ट';
    const title = `📢 नई ${topicLabel} - ${post.name}`;
    const body = post.title.length > 80 ? post.title.slice(0, 77) + '...' : post.title;

    await helper.sendFcmMulticast(tokens, title, body, { type: 'post', clickUrl: '/posts' });
  } catch (err) {
    console.error('[Posts] FCM notify error:', err.message);
  }
}

// GET all approved posts (public)
router.get('/', async (req, res) => {
  try {
    const posts = await Post.find({ isApproved: true }).sort({ createdAt: -1 });
    const sanitized = posts.map(p => {
      const obj = p.toObject();
      delete obj.likedTokens;
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
    delete obj.likedTokens;
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
    const { name, title, content, topic, visitorToken, visitorName } = req.body;

    // Resolve author name: prefer visitorName from token, fallback to submitted name
    const authorName = (visitorName || name || '').trim();
    if (!authorName || !title || !content) {
      return res.status(400).json({ message: 'Name, title and content are required' });
    }

    // Generate unique edit token for user to edit their post later
    const editToken = crypto.randomBytes(32).toString('hex');

    const postData = {
      name: authorName,
      visitorToken: visitorToken || '',
      title: title.trim(),
      content: content.trim(),
      topic: topic && ['issue', 'good_work', 'message', 'announcement', 'feedback', 'thanks', 'lost_found', 'other'].includes(topic) ? topic : 'message',
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

// Helper function to get client IP address
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    req.ip ||
    'unknown'
  );
}

// POST like a post (token & IP validation)
router.post('/:id/like', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    if (!visitorToken) {
      return res.status(400).json({ message: 'Visitor token is required to like a post.' });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const clientIP = getClientIP(req);

    // Check if this token already liked the post
    if (post.likedTokens.includes(visitorToken)) {
      // Unlike - remove token and IP
      post.likedTokens = post.likedTokens.filter(t => t !== visitorToken);
      post.likedIPs = post.likedIPs.filter(i => i !== clientIP);
      post.likes = Math.max(0, post.likes - 1);
      await post.save();
      return res.json({ likes: post.likes, liked: false });
    }

    // Check if this IP already liked the post
    if (post.likedIPs.includes(clientIP)) {
      return res.status(403).json({ 
        message: 'A like from your IP address has already been recorded for this post.',
        alreadyLiked: true,
        reason: 'ip'
      });
    }

    // Apply like
    post.likedTokens.push(visitorToken);
    post.likedIPs.push(clientIP);
    post.likes += 1;
    await post.save();

    res.json({ likes: post.likes, liked: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET check if visitor token or IP has liked a post
router.get('/:id/check-like', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const visitorToken = req.query.visitorToken || '';
    const clientIP = getClientIP(req);

    // Check if token has liked
    const tokenHasLiked = visitorToken && post.likedTokens.includes(visitorToken);
    
    // Check if IP has liked
    const ipHasLiked = post.likedIPs.includes(clientIP);

    res.json({ 
      liked: tokenHasLiked || ipHasLiked,
      blockedByToken: tokenHasLiked,
      blockedByIP: ipHasLiked
    });
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

// ============ COMMENT ROUTES ============

// GET comments for a post
router.get('/:id/comments', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).select('comments');
    if (!post) return res.status(404).json({ message: 'Post not found' });

    // Strip private fields from comments
    const comments = post.comments.map(c => ({
      _id: c._id,
      visitorName: c.visitorName,
      text: c.text,
      likes: c.likes,
      createdAt: c.createdAt,
      // Tell caller if this visitor has liked the comment
      liked: req.query.visitorToken ? c.likedTokens.includes(req.query.visitorToken) : false
    }));
    res.json(comments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST add a comment (uses visitorToken + visitorName — no manual name required)
router.post('/:id/comments', async (req, res) => {
  try {
    const { visitorToken, visitorName, text } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'Visitor token required' });
    if (!visitorName || !visitorName.trim()) return res.status(400).json({ message: 'Visitor name required' });
    if (!text || !text.trim()) return res.status(400).json({ message: 'Comment text required' });
    if (text.trim().length > 500) return res.status(400).json({ message: 'Comment too long (max 500 chars)' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = {
      visitorToken,
      visitorName: visitorName.trim(),
      text: text.trim(),
      likes: 0,
      likedTokens: [],
      createdAt: new Date()
    };
    post.comments.push(comment);
    await post.save();

    const saved = post.comments[post.comments.length - 1];
    res.status(201).json({
      _id: saved._id,
      visitorName: saved.visitorName,
      text: saved.text,
      likes: saved.likes,
      createdAt: saved.createdAt,
      liked: false
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST like/unlike a comment
router.post('/:id/comments/:commentId/like', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'Visitor token required' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    const alreadyLiked = comment.likedTokens.includes(visitorToken);
    if (alreadyLiked) {
      comment.likedTokens = comment.likedTokens.filter(t => t !== visitorToken);
      comment.likes = Math.max(0, comment.likes - 1);
    } else {
      comment.likedTokens.push(visitorToken);
      comment.likes += 1;
    }
    await post.save();
    res.json({ likes: comment.likes, liked: !alreadyLiked });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a comment (author or admin)
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });

    // Allow deletion only by the comment author (via visitorToken) or admin
    const isAdmin = req.headers.authorization && await verifyAdminToken(req.headers.authorization);
    if (!isAdmin && comment.visitorToken !== visitorToken) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    comment.deleteOne();
    await post.save();
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper to verify admin token (reuse auth middleware logic)
async function verifyAdminToken(authHeader) {
  try {
    const jwt = require('jsonwebtoken');
    const token = authHeader.replace('Bearer ', '');
    jwt.verify(token, process.env.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

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
    const wasApproved = post.isApproved;
    post.isApproved = !post.isApproved;
    await post.save();
    // Notify all users only when post is newly approved (not when unapproved)
    if (!wasApproved && post.isApproved) {
      notifyNewPost(post);
    }
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET all comments for a post (admin — includes visitorToken)
router.get('/:id/admin/comments', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).select('comments title name');
    if (!post) return res.status(404).json({ message: 'Post not found' });
    res.json({ postTitle: post.title, postAuthor: post.name, comments: post.comments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a comment (admin — no token check)
router.delete('/:id/admin/comments/:commentId', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });
    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ message: 'Comment not found' });
    comment.deleteOne();
    await post.save();
    res.json({ message: 'Comment deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


/* ── Admin: boost likes ──────────────────────────────────────
   Adds likes to a post from the Admin Panel. The site shows a single number,
   but `boostedLikes` records how many were added so genuine engagement stays
   measurable. Send a negative number to take them back off. */
router.post('/:id/boost', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const delta = Math.max(-5000, Math.min(parseInt(req.body.likes, 10) || 0, 5000));
    if (!delta) return res.status(400).json({ message: 'Give a number of likes to add' });

    // Never let a boost pull the total below the organic likes it started with.
    const organic = Math.max(0, (post.likes || 0) - (post.boostedLikes || 0));
    const nextBoost = Math.max(0, (post.boostedLikes || 0) + delta);

    post.boostedLikes = nextBoost;
    post.likes = organic + nextBoost;
    await post.save();

    res.json({
      message: delta > 0 ? `Added ${delta} like(s)` : `Removed ${-delta} like(s)`,
      likes: post.likes, boostedLikes: post.boostedLikes, realLikes: organic
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
