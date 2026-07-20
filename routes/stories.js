const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const Story = require('../models/Story');
const Visitor = require('../models/Visitor');
const auth = require('../middleware/auth');
const storyUpload = require('../middleware/storyUpload');

const MAX_ACTIVE_STORIES_PER_VISITOR = 3;
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;

// POST create a new story (public — any visitor)
router.post('/', storyUpload.single('media'), async (req, res) => {
  try {
    const { visitorToken, name, caption } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'visitorToken required' });
    if (!req.file) return res.status(400).json({ message: 'Media file required' });

    const activeCount = await Story.countDocuments({ visitorToken, expiresAt: { $gt: new Date() } });
    if (activeCount >= MAX_ACTIVE_STORIES_PER_VISITOR) {
      // Reject and clean up the asset we just uploaded before finding out about the cap
      cloudinary.uploader.destroy(req.file.filename).catch(() => {});
      return res.status(429).json({ message: `Story limit reached (${MAX_ACTIVE_STORIES_PER_VISITOR} active statuses)` });
    }

    // Resolve author identity server-side from the Visitor record — same
    // convention as the Nearby People feature — instead of trusting a
    // freshly re-uploaded profile photo on every single status.
    let authorName = (name || '').trim();
    let profilePic;
    const visitor = await Visitor.findOne({ visitorToken }).select('registeredName visitorName registeredPhoto');
    if (visitor) {
      authorName = visitor.registeredName || visitor.visitorName || authorName;
      profilePic = visitor.registeredPhoto || undefined;
    }
    if (!authorName) authorName = 'आगंतुक';

    const now = new Date();
    const story = await Story.create({
      visitorToken,
      name: authorName,
      profilePic,
      mediaUrl: req.file.path,
      mediaCloudinaryId: req.file.filename,
      caption: caption ? caption.trim() : undefined,
      createdAt: now,
      expiresAt: new Date(now.getTime() + STORY_LIFETIME_MS),
    });

    res.status(201).json(story);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET active stories, grouped by author (public)
// ?visitorToken=... determines seen/unseen state relative to the requester
router.get('/', async (req, res) => {
  try {
    const { visitorToken } = req.query;
    const stories = await Story.find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: 1 }) // oldest-first within an author's sequence
      .lean();

    const groups = new Map();
    for (const s of stories) {
      const key = s.visitorToken;
      if (!groups.has(key)) {
        groups.set(key, {
          visitorToken: key,
          name: s.name,
          profilePic: s.profilePic,
          stories: [],
          hasUnseen: false,
        });
      }
      const g = groups.get(key);
      const seenByMe = !!(visitorToken && s.viewedTokens && s.viewedTokens.includes(visitorToken));
      const likedByMe = !!(visitorToken && s.likedTokens && s.likedTokens.includes(visitorToken));
      if (!seenByMe) g.hasUnseen = true;
      g.stories.push({
        _id: s._id,
        mediaUrl: s.mediaUrl,
        caption: s.caption,
        viewCount: s.viewCount,
        likeCount: s.likeCount || 0,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        seenByMe,
        likedByMe,
      });
    }

    const result = Array.from(groups.values());
    // Own status first, then any group with an unseen story, then most-recent first
    result.sort((a, b) => {
      if (visitorToken) {
        if (a.visitorToken === visitorToken) return -1;
        if (b.visitorToken === visitorToken) return 1;
      }
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      const aLatest = a.stories[a.stories.length - 1]?.createdAt || 0;
      const bLatest = b.stories[b.stories.length - 1]?.createdAt || 0;
      return new Date(bLatest) - new Date(aLatest);
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST mark a story as viewed (public, idempotent per visitorToken)
router.post('/:id/view', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'visitorToken required' });

    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });

    if (!story.viewedTokens.includes(visitorToken)) {
      story.viewedTokens.push(visitorToken);
      story.viewCount += 1;
      await story.save();
    }

    res.json({ viewCount: story.viewCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET who viewed/liked a story — owner only (matches Instagram's own-story
// "Activity" view: one combined list, most-recent viewer first, with a
// heart marker on whoever also liked it).
router.get('/:id/viewers', async (req, res) => {
  try {
    const { visitorToken } = req.query;
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (!visitorToken || visitorToken !== story.visitorToken) {
      return res.status(403).json({ message: 'Only the poster can see this' });
    }

    const visitors = await Visitor.find({ visitorToken: { $in: story.viewedTokens } })
      .select('visitorToken registeredName visitorName registeredPhoto');
    const infoMap = new Map(visitors.map(v => [v.visitorToken, v]));

    // viewedTokens is append-only, so reversing gives most-recent-first
    const viewers = story.viewedTokens.slice().reverse().map(token => {
      const v = infoMap.get(token);
      return {
        name: (v && (v.registeredName || v.visitorName)) || 'आगंतुक',
        profilePic: v ? v.registeredPhoto : undefined,
        liked: story.likedTokens.includes(token),
      };
    });

    res.json({ viewCount: story.viewCount, likeCount: story.likeCount, viewers });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST toggle like on a story (public)
router.post('/:id/like', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    if (!visitorToken) return res.status(400).json({ message: 'visitorToken required' });

    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });

    const idx = story.likedTokens.indexOf(visitorToken);
    let liked;
    if (idx === -1) {
      story.likedTokens.push(visitorToken);
      story.likeCount += 1;
      liked = true;
    } else {
      story.likedTokens.splice(idx, 1);
      story.likeCount = Math.max(0, story.likeCount - 1);
      liked = false;
    }
    await story.save();

    res.json({ liked, likeCount: story.likeCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE own story early (public — ownership checked via visitorToken)
router.delete('/:id', async (req, res) => {
  try {
    const { visitorToken } = req.body;
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });
    if (!visitorToken || visitorToken !== story.visitorToken) {
      return res.status(403).json({ message: 'Not the owner of this story' });
    }

    await cloudinary.uploader.destroy(story.mediaCloudinaryId).catch(() => {});
    await story.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE any story (admin moderation)
router.delete('/:id/admin', auth, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ message: 'Story not found' });

    await cloudinary.uploader.destroy(story.mediaCloudinaryId).catch(() => {});
    await story.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
