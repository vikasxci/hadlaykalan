/**
 * services/storyExpiryCron.js
 *
 * Every 10 minutes, permanently deletes expired statuses: removes the
 * Cloudinary asset first, then the MongoDB document. The Story model's
 * TTL index is only a safety net for the MongoDB side — it cannot reach
 * Cloudinary, so this cron is the authoritative cleanup path.
 */

const cron = require('node-cron');
const cloudinary = require('cloudinary').v2;
const Story = require('../models/Story');

async function cleanupExpiredStories() {
  const expired = await Story.find({ expiresAt: { $lte: new Date() } });
  if (!expired.length) return;

  for (const story of expired) {
    try {
      await cloudinary.uploader.destroy(story.mediaCloudinaryId);
    } catch (err) {
      console.error(`[StoryCron] Cloudinary delete failed for ${story._id}:`, err.message);
      // Still remove the DB doc — the TTL index would eventually clear it
      // anyway, and we don't want one bad asset to block the whole sweep.
    }
    try {
      await story.deleteOne();
    } catch (err) {
      console.error(`[StoryCron] DB delete failed for ${story._id}:`, err.message);
    }
  }

  console.log(`[StoryCron] Cleaned up ${expired.length} expired stor${expired.length === 1 ? 'y' : 'ies'}`);
}

function startStoryExpiryCron() {
  cron.schedule('*/10 * * * *', () => {
    cleanupExpiredStories().catch(err => console.error('[StoryCron] Sweep error:', err.message));
  });
}

module.exports = { startStoryExpiryCron, cleanupExpiredStories };
