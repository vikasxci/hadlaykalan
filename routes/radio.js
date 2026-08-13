const express = require('express');
const router = express.Router();
const RadioPlaylist = require('../models/RadioPlaylist');
const RadioTrack = require('../models/RadioTrack');
const RadioPlay = require('../models/RadioPlay');
const Visitor = require('../models/Visitor');
const auth = require('../middleware/auth');
const { fetchPlaylist, parsePlaylistId, verifyEmbeddable, checkEmbeddable, SCRAPE_CAP } =
  require('../services/youtubePlaylist');

const VIDEO_ID = /^[\w-]{11}$/;

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function istHourNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === 'hour');
  return h ? parseInt(h.value, 10) % 24 : new Date().getHours();
}

/* ══════════════════════════════════════════════════════════
   PUBLIC — used by the village website
   ══════════════════════════════════════════════════════════ */

// Playlist list only (no tracks) — keeps the first paint small on mobile data.
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await RadioPlaylist.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .select('slug name emoji istStart istEnd order')
      .lean();

    const counts = await RadioTrack.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$playlist', n: { $sum: 1 } } }
    ]);
    const byId = new Map(counts.map(c => [String(c._id), c.n]));

    res.json(playlists
      .map(p => ({ ...p, trackCount: byId.get(String(p._id)) || 0 }))
      .filter(p => p.trackCount > 0));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Tracks for one playlist, fetched when the listener picks it.
router.get('/playlists/:slug/tracks', async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findOne({ slug: req.params.slug, isActive: true }).lean();
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    const tracks = await RadioTrack.find({ playlist: playlist._id, isActive: true })
      .sort({ order: 1, _id: 1 })
      .select('videoId title channel durationSeconds')
      .lean();

    res.json({
      slug: playlist.slug,
      name: playlist.name,
      emoji: playlist.emoji,
      tracks
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// A listener started a song. Drives both the running counter and the log.
router.post('/play', async (req, res) => {
  try {
    const { videoId, playlistSlug, visitorToken } = req.body || {};
    if (!VIDEO_ID.test(String(videoId || ''))) {
      return res.status(400).json({ message: 'Invalid videoId' });
    }

    const track = await RadioTrack.findOne({ videoId }).select('_id playlist title').lean();

    await RadioPlay.create({
      track: track ? track._id : null,
      playlist: track ? track.playlist : null,
      videoId,
      title: String(req.body.title || (track && track.title) || '').slice(0, 200),
      playlistSlug: String(playlistSlug || '').slice(0, 40),
      visitorToken: String(visitorToken || '').slice(0, 120),
      istHour: istHourNow()
    });

    if (track) {
      await RadioTrack.updateOne({ _id: track._id },
        { $inc: { playCount: 1 }, $set: { lastPlayedAt: new Date() } });
    }
    if (playlistSlug) {
      await RadioPlaylist.updateOne({ slug: playlistSlug }, { $inc: { playCount: 1 } });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/*
 * A listener's player failed to play a song. A failing song must disappear for
 * everyone else — but "failing" has to be established, not assumed, or one
 * person on a weak signal empties the playlist.
 *
 * Two independent ways a song gets pulled:
 *
 *   1. YouTube confirms it. Codes 100/101/150 mean removed, private, or
 *      embedding blocked. Verified against YouTube, then retired immediately —
 *      one report is enough because the evidence is authoritative.
 *
 *   2. It keeps failing for DIFFERENT people. Region locks and age gates are
 *      invisible to YouTube's public endpoints, so a song can be genuinely
 *      unplayable here while every check says it is fine. Once it has failed
 *      for DISTINCT_LISTENER_LIMIT separate listeners it is retired too.
 *
 * Code 5 (generic HTML5 error) and code 2 still count toward rule 2, but a
 * single listener hitting them repeatedly never retires anything.
 */
const PERMANENT_ERROR_CODES = new Set([100, 101, 150]);

// How many *different* listeners a song must fail for before it is pulled from
// the playlist even though YouTube claims it is fine. One listener is a bad
// connection; three separate people is a broken song. Village listeners often
// share a tower, so this is deliberately not 2.
const DISTINCT_LISTENER_LIMIT = 3;

router.post('/track-error', async (req, res) => {
  try {
    const { videoId, playlistSlug } = req.body || {};
    if (!VIDEO_ID.test(String(videoId || ''))) {
      return res.status(400).json({ message: 'Invalid videoId' });
    }
    const code = Number(req.body.code);
    const who = String(req.body.visitorToken || '').slice(0, 120);

    // Scope to the playlist being listened to — the same song can sit in
    // several playlists and a strike must not land on the wrong copy.
    let track = null;
    if (playlistSlug) {
      const pl = await RadioPlaylist.findOne({ slug: String(playlistSlug) }).select('_id').lean();
      if (pl) track = await RadioTrack.findOne({ playlist: pl._id, videoId });
    }
    if (!track) track = await RadioTrack.findOne({ videoId });
    if (!track) return res.json({ ok: true });

    track.lastErrorAt = new Date();
    track.errorCount += 1;

    // Remember who it failed for. An anonymous listener still counts as one
    // distinct reporter so the mechanism works before people register.
    const id = who || 'anon:' + (req.ip || 'unknown');
    if (!track.errorTokens.includes(id)) {
      track.errorTokens.push(id);
      if (track.errorTokens.length > 20) track.errorTokens = track.errorTokens.slice(-20);
    }
    const distinct = track.errorTokens.length;

    const retire = (by, reason) => {
      track.isActive = false;
      track.disabledBy = by;
      track.errorReason = reason;
    };

    // 1. YouTube says it is unplayable → pull it immediately, for everyone.
    if (PERMANENT_ERROR_CODES.has(code)) {
      const verdict = await checkEmbeddable(videoId);
      if (!verdict.ok) {
        retire('youtube', verdict.reason || 'not playable outside YouTube');
        await track.save();
        return res.json({ ok: true, deactivated: true, by: 'youtube', reason: track.errorReason });
      }
    }

    // 2. YouTube won't admit to it, but it keeps failing for different people —
    //    region locks and age gates look exactly like this. Pull it anyway so
    //    the next listener never meets it.
    if (distinct >= DISTINCT_LISTENER_LIMIT) {
      const verdict = await checkEmbeddable(videoId);
      if (!verdict.ok) retire('youtube', verdict.reason);
      else retire('listeners', `failed for ${distinct} different listeners`);
      await track.save();
      return res.json({ ok: true, deactivated: true, by: track.disabledBy,
                        reason: track.errorReason, listeners: distinct });
    }

    // 3. Not enough evidence yet — keep serving it.
    await track.save();
    res.json({ ok: true, deactivated: false, listeners: distinct,
               needed: DISTINCT_LISTENER_LIMIT });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════
   ADMIN
   ══════════════════════════════════════════════════════════ */

router.get('/admin/playlists', auth, async (req, res) => {
  try {
    const playlists = await RadioPlaylist.find().sort({ order: 1, name: 1 }).lean();

    const stats = await RadioTrack.aggregate([
      { $group: {
          _id: '$playlist',
          total:  { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
          plays:  { $sum: '$playCount' }
      } }
    ]);
    const byId = new Map(stats.map(s => [String(s._id), s]));

    res.json(playlists.map(p => {
      const s = byId.get(String(p._id)) || { total: 0, active: 0, plays: 0 };
      return { ...p, trackCount: s.total, activeCount: s.active, trackPlays: s.plays };
    }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/admin/playlists', auth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Name is required' });

    const slug = slugify(req.body.slug || name) || 'playlist-' + Date.now();
    if (await RadioPlaylist.findOne({ slug })) {
      return res.status(409).json({ message: `A playlist with slug "${slug}" already exists` });
    }

    const playlist = await RadioPlaylist.create({
      name,
      slug,
      emoji: req.body.emoji || '🎵',
      istStart: req.body.istStart === '' || req.body.istStart == null ? null : Number(req.body.istStart),
      istEnd:   req.body.istEnd   === '' || req.body.istEnd   == null ? null : Number(req.body.istEnd),
      sourceUrl: String(req.body.sourceUrl || '').trim(),
      order: Number(req.body.order) || 0,
      isActive: req.body.isActive !== false
    });
    res.status(201).json(playlist);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/admin/playlists/:id', auth, async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    if (req.body.name != null)      playlist.name = String(req.body.name).trim() || playlist.name;
    if (req.body.emoji != null)     playlist.emoji = req.body.emoji;
    if (req.body.sourceUrl != null) playlist.sourceUrl = String(req.body.sourceUrl).trim();
    if (req.body.order != null)     playlist.order = Number(req.body.order) || 0;
    if (req.body.isActive != null)  playlist.isActive = !!req.body.isActive;
    if ('istStart' in req.body) playlist.istStart = req.body.istStart === '' || req.body.istStart == null ? null : Number(req.body.istStart);
    if ('istEnd'   in req.body) playlist.istEnd   = req.body.istEnd   === '' || req.body.istEnd   == null ? null : Number(req.body.istEnd);

    if (req.body.slug) {
      const slug = slugify(req.body.slug);
      if (slug && slug !== playlist.slug) {
        if (await RadioPlaylist.findOne({ slug, _id: { $ne: playlist._id } })) {
          return res.status(409).json({ message: `Slug "${slug}" is already used` });
        }
        playlist.slug = slug;
      }
    }

    await playlist.save();
    res.json(playlist);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/admin/playlists/:id', auth, async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });
    await RadioTrack.deleteMany({ playlist: playlist._id });
    await playlist.deleteOne();
    res.json({ message: 'Playlist and its songs deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Paste a YouTube playlist URL → pull in every video as a song.
// mode=replace wipes the existing songs; mode=append keeps them and adds new ones.
router.post('/admin/playlists/:id/import', auth, async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    const url = String(req.body.url || playlist.sourceUrl || '').trim();
    if (!url) return res.status(400).json({ message: 'Paste a YouTube playlist link first' });
    if (!parsePlaylistId(url)) {
      return res.status(400).json({ message: 'That is not a YouTube playlist link (it needs a "list=" id)' });
    }

    const mode = req.body.mode === 'append' ? 'append' : 'replace';

    let result;
    try {
      result = await fetchPlaylist(url, { max: req.body.max });
    } catch (err) {
      return res.status(422).json({ message: err.message });
    }

    // Drop the videos the uploader has blocked from embedding before they ever
    // reach the playlist — those are the songs that would "skip" for listeners.
    let rejected = [];
    if (req.body.verify !== false) {
      const checked = await verifyEmbeddable(result.tracks);
      result.tracks = checked.playable;
      rejected = checked.rejected;
    }

    if (mode === 'replace') {
      await RadioTrack.deleteMany({ playlist: playlist._id });
    }

    const existing = mode === 'append'
      ? new Set((await RadioTrack.find({ playlist: playlist._id }).select('videoId').lean())
          .map(t => t.videoId))
      : new Set();

    let order = mode === 'append'
      ? (await RadioTrack.countDocuments({ playlist: playlist._id }))
      : 0;

    const ops = [];
    for (const t of result.tracks) {
      if (existing.has(t.videoId)) continue;
      existing.add(t.videoId);
      ops.push({
        updateOne: {
          filter: { playlist: playlist._id, videoId: t.videoId },
          update: {
            $set: {
              title: t.title,
              channel: t.channel || '',
              durationSeconds: t.durationSeconds || 0,
              order: order++,
              isActive: true
            },
            $setOnInsert: { playCount: 0, errorCount: 0 }
          },
          upsert: true
        }
      });
    }
    if (ops.length) await RadioTrack.bulkWrite(ops, { ordered: false });

    playlist.sourceUrl = url;
    playlist.sourcePlaylistId = result.playlistId;
    playlist.lastSyncedAt = new Date();
    playlist.lastSyncCount = ops.length;
    playlist.lastSyncMethod = result.method;
    await playlist.save();

    const total = await RadioTrack.countDocuments({ playlist: playlist._id });
    const notes = [];
    if (rejected.length) {
      notes.push(`${rejected.length} song(s) were left out because YouTube will not let them play outside youtube.com`);
    }
    if (result.method === 'scrape' && result.truncated) {
      notes.push(`YouTube only exposes the first ${SCRAPE_CAP} videos without an API key — set YOUTUBE_API_KEY to import the whole playlist`);
    }

    res.json({
      message: `${ops.length} songs imported (${total} in this playlist)`,
      imported: ops.length,
      total,
      method: result.method,
      truncated: result.truncated,
      rejected: rejected.map(r => ({ videoId: r.videoId, title: r.title, reason: r.reason })),
      note: notes.join('. ')
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Repair pass across every playlist: bring back songs that were switched off by
// playback errors but that YouTube still reports as playable, and clear the
// error counters. This undoes damage from transient errors on poor connections.
router.post('/admin/repair', auth, async (req, res) => {
  try {
    // Songs pulled because they kept failing for different listeners pass
    // YouTube's own check by definition (region locks and age gates are
    // invisible to it), so restoring them would just put broken songs back in
    // front of people. Only do that when the admin explicitly asks.
    const includeListenerFlagged = req.body.includeListenerFlagged === true;
    const scope = { isActive: false, errorCount: { $gt: 0 } };
    if (!includeListenerFlagged) scope.disabledBy = { $ne: 'listeners' };

    const suspects = await RadioTrack.find(scope)
      .select('videoId title playlist disabledBy').lean();

    const listenerFlagged = await RadioTrack.countDocuments({ isActive: false, disabledBy: 'listeners' });

    if (!suspects.length) {
      const cleared = (await RadioTrack.updateMany(
        { isActive: true, errorCount: { $gt: 0 } },
        { $set: { errorCount: 0, errorReason: '', errorTokens: [] } })).modifiedCount;
      return res.json({
        message: `Nothing to restore. Cleared ${cleared} stale error counter(s).` +
          (listenerFlagged ? ` ${listenerFlagged} song(s) stay off because they kept failing for real listeners.` : ''),
        restored: 0, stillBad: 0, cleared, listenerFlagged });
    }

    const { playable, rejected } = await verifyEmbeddable(suspects);

    const restored = playable.length
      ? (await RadioTrack.updateMany(
          { _id: { $in: playable.map(t => t._id) } },
          { $set: { isActive: true, errorCount: 0, errorReason: '', disabledBy: '',
                    errorTokens: [], lastErrorAt: null } })).modifiedCount
      : 0;

    // Record why the genuinely dead ones stay off.
    for (const t of rejected) {
      await RadioTrack.updateOne({ _id: t._id },
        { $set: { errorReason: t.reason || 'not playable', disabledBy: 'youtube' } });
    }

    // Songs still playing but carrying old strikes get a clean slate too.
    const cleared = (await RadioTrack.updateMany(
      { isActive: true, errorCount: { $gt: 0 } },
      { $set: { errorCount: 0, errorReason: '', errorTokens: [] } })).modifiedCount;

    res.json({
      message: `Restored ${restored} song(s) that were switched off but still play. ` +
               `${rejected.length} are genuinely blocked by YouTube. Cleared ${cleared} stale counter(s).` +
               (!includeListenerFlagged && listenerFlagged
                 ? ` ${listenerFlagged} song(s) left off — they kept failing for real listeners.` : ''),
      restored, stillBad: rejected.length, cleared, listenerFlagged,
      rejected: rejected.slice(0, 20).map(t => ({ title: t.title, reason: t.reason }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Re-check every song in a playlist and switch off the ones YouTube refuses to
// embed. Use this on playlists imported before verification existed, or when a
// song that used to work starts failing.
router.post('/admin/playlists/:id/verify', auth, async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    const tracks = await RadioTrack.find({ playlist: playlist._id })
      .select('videoId title isActive').lean();
    if (!tracks.length) return res.json({ message: 'No songs to check', disabled: 0, restored: 0 });

    const { playable, rejected } = await verifyEmbeddable(tracks);

    const badIds = rejected.map(t => t.videoId);
    const goodIds = playable.map(t => t.videoId);

    const disabled = badIds.length
      ? (await RadioTrack.updateMany(
          { playlist: playlist._id, videoId: { $in: badIds } },
          { $set: { isActive: false, lastErrorAt: new Date(), disabledBy: 'youtube' },
            $inc: { errorCount: 1 } })).modifiedCount
      : 0;

    // A song that only ever failed the embed check gets another chance once it
    // passes again. Songs an admin switched off by hand stay off.
    const restored = goodIds.length
      ? (await RadioTrack.updateMany(
          { playlist: playlist._id, videoId: { $in: goodIds }, isActive: false,
            errorCount: { $gt: 0 }, disabledBy: { $ne: 'listeners' } },
          { $set: { isActive: true, errorCount: 0, errorReason: '', disabledBy: '',
                    errorTokens: [], lastErrorAt: null } })).modifiedCount
      : 0;

    const active = await RadioTrack.countDocuments({ playlist: playlist._id, isActive: true });
    res.json({
      message: `Checked ${tracks.length} songs — ${disabled} switched off, ${restored} restored, ${active} playable`,
      checked: tracks.length, disabled, restored, active,
      rejected: rejected.map(r => ({ videoId: r.videoId, title: r.title, reason: r.reason }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/admin/playlists/:id/tracks', auth, async (req, res) => {
  try {
    const tracks = await RadioTrack.find({ playlist: req.params.id })
      .sort({ order: 1, _id: 1 })
      .lean();
    // Send how many listeners it failed for, never the visitor tokens themselves.
    res.json(tracks.map(({ errorTokens, ...t }) => ({
      ...t, errorListeners: (errorTokens || []).length
    })));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add a single song by video link or id.
router.post('/admin/playlists/:id/tracks', auth, async (req, res) => {
  try {
    const playlist = await RadioPlaylist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

    const raw = String(req.body.video || '').trim();
    let videoId = raw;
    if (!VIDEO_ID.test(videoId)) {
      const m = /(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/.exec(raw);
      videoId = m ? m[1] : '';
    }
    if (!VIDEO_ID.test(videoId)) {
      return res.status(400).json({ message: 'Paste a YouTube video link or its 11-character id' });
    }

    if (await RadioTrack.findOne({ playlist: playlist._id, videoId })) {
      return res.status(409).json({ message: 'That song is already in this playlist' });
    }

    // Take the real YouTube title unless the admin typed one.
    let title = String(req.body.title || '').trim();
    let channel = '';
    if (!title) {
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' +
          encodeURIComponent('https://www.youtube.com/watch?v=' + videoId));
        if (r.ok) {
          const d = await r.json();
          title = d.title || '';
          channel = d.author_name || '';
        }
      } catch (e) { /* fall through to the guard below */ }
    }
    if (!title) return res.status(422).json({ message: 'Could not read that video from YouTube' });

    // Refuse a song that would only skip for listeners. (When we fetched the
    // title above the oEmbed call already proved it embeds; this covers the
    // case where the admin supplied their own title.)
    const embed = await checkEmbeddable(videoId);
    if (!embed.ok) {
      return res.status(422).json({
        message: `YouTube will not let this video play outside youtube.com (${embed.reason}) — pick another upload of the song`
      });
    }

    const order = await RadioTrack.countDocuments({ playlist: playlist._id });
    const track = await RadioTrack.create({
      playlist: playlist._id, videoId, title, channel, order
    });
    res.status(201).json(track);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/admin/tracks/:id', auth, async (req, res) => {
  try {
    const track = await RadioTrack.findById(req.params.id);
    if (!track) return res.status(404).json({ message: 'Song not found' });

    if (req.body.title != null)    track.title = String(req.body.title).trim() || track.title;
    if (req.body.order != null)    track.order = Number(req.body.order) || 0;
    if (req.body.isActive != null) {
      track.isActive = !!req.body.isActive;
      if (track.isActive) {
        // Re-enabling by hand gives the song a clean slate, otherwise a single
        // further failure would immediately trip the listener threshold again.
        track.errorCount = 0;
        track.errorTokens = [];
        track.errorReason = '';
        track.disabledBy = '';
      } else {
        track.disabledBy = 'admin';
      }
    }
    await track.save();
    res.json(track);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/admin/tracks/:id', auth, async (req, res) => {
  try {
    const track = await RadioTrack.findByIdAndDelete(req.params.id);
    if (!track) return res.status(404).json({ message: 'Song not found' });
    res.json({ message: 'Song removed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// What the village is actually listening to.
router.get('/admin/stats', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    const since = new Date(Date.now() - days * 86400000);

    const [topTracks, topPlaylists, byHour, byDay, totals, recent, listeners] = await Promise.all([
      RadioTrack.find({ playCount: { $gt: 0 } })
        .sort({ playCount: -1 }).limit(25)
        .populate('playlist', 'name emoji slug')
        .select('title videoId playCount lastPlayedAt playlist').lean(),

      RadioPlay.aggregate([
        { $match: { playedAt: { $gte: since }, playlistSlug: { $ne: '' } } },
        { $group: { _id: '$playlistSlug', plays: { $sum: 1 } } },
        { $sort: { plays: -1 } }
      ]),

      RadioPlay.aggregate([
        { $match: { playedAt: { $gte: since }, istHour: { $ne: null } } },
        { $group: { _id: '$istHour', plays: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]),

      RadioPlay.aggregate([
        { $match: { playedAt: { $gte: since } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$playedAt', timezone: 'Asia/Kolkata' } },
            plays: { $sum: 1 }
        } },
        { $sort: { _id: 1 } }
      ]),

      RadioPlay.aggregate([
        { $match: { playedAt: { $gte: since } } },
        { $group: { _id: null, plays: { $sum: 1 }, listeners: { $addToSet: '$visitorToken' } } },
        { $project: { _id: 0, plays: 1, listeners: { $size: '$listeners' } } }
      ]),

      RadioPlay.find({}).sort({ playedAt: -1 }).limit(60)
        .select('title videoId playlistSlug playedAt visitorToken').lean(),

      // Who listened, how much, and what they last played.
      RadioPlay.aggregate([
        { $match: { playedAt: { $gte: since }, visitorToken: { $nin: ['', null] } } },
        { $sort: { playedAt: -1 } },
        { $group: {
            _id: '$visitorToken',
            plays:      { $sum: 1 },
            songs:      { $addToSet: '$videoId' },
            playlists:  { $addToSet: '$playlistSlug' },
            lastAt:     { $first: '$playedAt' },
            lastTitle:  { $first: '$title' },
            firstAt:    { $last: '$playedAt' }
        } },
        { $project: { _id: 1, plays: 1, playlists: 1, lastAt: 1, lastTitle: 1, firstAt: 1,
                      uniqueSongs: { $size: '$songs' } } },
        { $sort: { plays: -1 } },
        { $limit: 50 }
      ])
    ]);

    const names = new Map((await RadioPlaylist.find().select('slug name emoji').lean())
      .map(p => [p.slug, p]));

    // Put a real person against each token where the site knows one.
    const tokens = [...new Set([
      ...listeners.map(l => l._id),
      ...recent.map(r => r.visitorToken).filter(Boolean)
    ])];
    const visitors = tokens.length
      ? await Visitor.find({ visitorToken: { $in: tokens } })
          .select('visitorToken visitorName registeredName registeredPhone registeredArea ' +
                  'registeredProfession isRegistered city device browser')
          .lean()
      : [];
    const byToken = new Map(visitors.map(v => [v.visitorToken, v]));

    // `registered` means the person completed registration on the website.
    // A name can exist without that (they typed one for the streak popup), so
    // the two are reported separately rather than collapsed into one flag.
    const describe = token => {
      const v = byToken.get(token);
      if (!v) return { token, name: 'अनजान श्रोता', registered: false, named: false };
      const name = v.registeredName || v.visitorName || '';
      return {
        token,
        registered: v.isRegistered === true,
        named: !!name,
        name: name || 'अनजान श्रोता',
        phone: v.registeredPhone || '',
        area: v.registeredArea || v.city || '',
        profession: v.registeredProfession || '',
        device: [v.device, v.browser].filter(Boolean).join(' · ')
      };
    };

    res.json({
      days,
      totals: totals[0] || { plays: 0, listeners: 0 },
      topTracks,
      topPlaylists: topPlaylists.map(p => ({
        slug: p._id,
        plays: p.plays,
        name: (names.get(p._id) || {}).name || p._id,
        emoji: (names.get(p._id) || {}).emoji || '🎵'
      })),
      byHour,
      byDay,
      listeners: listeners.map(l => ({
        ...describe(l._id),
        plays: l.plays,
        uniqueSongs: l.uniqueSongs,
        playlists: (l.playlists || []).filter(Boolean)
          .map(s => (names.get(s) || {}).name || s),
        lastTitle: l.lastTitle,
        lastAt: l.lastAt,
        firstAt: l.firstAt
      })),
      recent: recent.map(r => ({
        title: r.title,
        videoId: r.videoId,
        playlistSlug: r.playlistSlug,
        playlistName: (names.get(r.playlistSlug) || {}).name || r.playlistSlug,
        playedAt: r.playedAt,
        listener: describe(r.visitorToken || '')
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Everything one listener has played — the drill-down from the listeners table.
router.get('/admin/listeners/:token/plays', auth, async (req, res) => {
  try {
    const token = String(req.params.token || '');
    if (!token) return res.status(400).json({ message: 'Missing listener token' });

    const [plays, visitor, playlists] = await Promise.all([
      RadioPlay.find({ visitorToken: token }).sort({ playedAt: -1 }).limit(300)
        .select('title videoId playlistSlug playedAt istHour').lean(),
      Visitor.findOne({ visitorToken: token })
        .select('visitorName registeredName registeredPhone registeredArea registeredProfession ' +
                'isRegistered city device browser os firstVisit lastVisit visitCount currentStreak').lean(),
      RadioPlaylist.find().select('slug name emoji').lean()
    ]);

    const names = new Map(playlists.map(p => [p.slug, p]));

    res.json({
      listener: visitor ? {
        token,
        registered: visitor.isRegistered === true,
        named: !!(visitor.registeredName || visitor.visitorName),
        name: visitor.registeredName || visitor.visitorName || 'अनजान श्रोता',
        phone: visitor.registeredPhone || '',
        area: visitor.registeredArea || visitor.city || '',
        profession: visitor.registeredProfession || '',
        device: [visitor.device, visitor.browser, visitor.os].filter(Boolean).join(' · '),
        visitCount: visitor.visitCount,
        currentStreak: visitor.currentStreak,
        firstVisit: visitor.firstVisit,
        lastVisit: visitor.lastVisit
      } : { token, registered: false, named: false, name: 'अनजान श्रोता' },
      totalPlays: plays.length,
      plays: plays.map(p => ({
        ...p,
        playlistName: (names.get(p.playlistSlug) || {}).name || p.playlistSlug
      }))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
