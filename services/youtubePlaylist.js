/* ============================================================
   YouTube playlist importer
   ------------------------------------------------------------
   Turns a playlist URL into [{ videoId, title, channel, durationSeconds }].

   Two paths:
     1. Data API v3  — used when YOUTUBE_API_KEY is set. Official, paginates
        through the whole playlist, gives durations. Preferred.
     2. Page scrape  — no key needed, but YouTube only ships the first 100
        videos in the initial page payload, so that is the cap.

   The scrape path exists so the feature works before anyone sets up a key;
   set YOUTUBE_API_KEY to lift the 100-video ceiling.
   ============================================================ */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SCRAPE_CAP = 100;

/** Pull the list id out of any YouTube playlist URL (or accept a bare id). */
function parsePlaylistId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (/^(PL|UU|OL|LL|FL|RD)[\w-]{10,}$/.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : 'https://' + raw);
  } catch (e) {
    return null;
  }
  const list = url.searchParams.get('list');
  return list && /^[\w-]{12,}$/.test(list) ? list : null;
}

/** ISO-8601 duration (PT4M13S) → seconds. */
function parseISODuration(iso) {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map(v => (v ? parseInt(v, 10) : 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

/** "4:13" / "1:02:03" → seconds. */
function parseClockDuration(text) {
  if (!text) return 0;
  const parts = String(text).split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

// Deleted and private entries stay in playlists forever; they have no title
// worth showing and will never play.
const DEAD_TITLES = new Set(['deleted video', 'private video', '[deleted video]', '[private video]']);
function isDead(title) {
  return !title || DEAD_TITLES.has(String(title).trim().toLowerCase());
}

/* ── Path 1: YouTube Data API v3 ─────────────────────────── */

async function fetchViaDataApi(playlistId, apiKey, maxItems) {
  const items = [];
  let pageToken = '';

  do {
    const url = 'https://www.googleapis.com/youtube/v3/playlistItems' +
      '?part=snippet,contentDetails&maxResults=50' +
      `&playlistId=${encodeURIComponent(playlistId)}` +
      `&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason = res.status === 404 ? 'Playlist not found or is private'
                   : res.status === 403 ? 'YouTube API key rejected or out of quota'
                   : `YouTube API error ${res.status}`;
      const err = new Error(reason);
      err.detail = body.slice(0, 300);
      throw err;
    }
    const data = await res.json();

    for (const it of data.items || []) {
      const sn = it.snippet || {};
      const videoId = it.contentDetails && it.contentDetails.videoId;
      if (!videoId || isDead(sn.title)) continue;
      items.push({
        videoId,
        title: sn.title,
        channel: sn.videoOwnerChannelTitle || sn.channelTitle || '',
        durationSeconds: 0
      });
      if (items.length >= maxItems) break;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken && items.length < maxItems);

  await attachDurations(items, apiKey);
  return items;
}

/** videos.list gives durations 50 ids at a time; failure here is not fatal. */
async function attachDurations(items, apiKey) {
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const url = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails' +
      `&id=${chunk.map(t => t.videoId).join(',')}&key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const byId = new Map((data.items || []).map(v => [v.id, v]));
      for (const t of chunk) {
        const v = byId.get(t.videoId);
        if (v) t.durationSeconds = parseISODuration(v.contentDetails.duration);
      }
    } catch (e) {
      return;
    }
  }
}

/* ── Path 2: page scrape (no key) ────────────────────────── */

function collectLockups(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectLockups(child, out);
    return out;
  }
  const lockup = node.lockupViewModel;
  if (lockup && typeof lockup.contentId === 'string' && lockup.contentId.length === 11) {
    let title = '';
    let duration = 0;
    try {
      title = lockup.metadata.lockupMetadataViewModel.title.content || '';
    } catch (e) { /* title stays empty, entry is dropped below */ }
    try {
      const badges = JSON.stringify(lockup.contentImage || {});
      const m = /"text":"(\d+:\d{2}(?::\d{2})?)"/.exec(badges);
      if (m) duration = parseClockDuration(m[1]);
    } catch (e) { /* duration is optional */ }
    out.push({ videoId: lockup.contentId, title, channel: '', durationSeconds: duration });
  }
  for (const key of Object.keys(node)) collectLockups(node[key], out);
  return out;
}

async function fetchViaScrape(playlistId, maxItems) {
  const res = await fetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
  });
  if (!res.ok) throw new Error(`Could not open the playlist page (HTTP ${res.status})`);
  const html = await res.text();

  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html);
  if (!m) throw new Error('YouTube returned an unexpected page — try again, or set YOUTUBE_API_KEY');

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    throw new Error('Could not read the playlist page');
  }

  const seen = new Set();
  const out = [];
  for (const t of collectLockups(data, [])) {
    if (seen.has(t.videoId) || isDead(t.title)) continue;
    seen.add(t.videoId);
    out.push(t);
    if (out.length >= Math.min(maxItems, SCRAPE_CAP)) break;
  }
  if (!out.length) {
    throw new Error('No videos found — the playlist may be private or empty');
  }
  return out;
}

/* ── Public entry point ──────────────────────────────────── */

/**
 * @param {string} urlOrId  playlist URL or bare list id
 * @param {object} [opts]   { max } — hard cap on imported tracks (default 300)
 * @returns {Promise<{playlistId, method, tracks, truncated}>}
 */
async function fetchPlaylist(urlOrId, opts = {}) {
  const max = Math.max(1, Math.min(parseInt(opts.max, 10) || 300, 1000));
  const playlistId = parsePlaylistId(urlOrId);
  if (!playlistId) {
    throw new Error('That does not look like a YouTube playlist link (it needs a "list=" id)');
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    try {
      const tracks = await fetchViaDataApi(playlistId, apiKey, max);
      if (tracks.length) {
        return { playlistId, method: 'api', tracks, truncated: tracks.length >= max };
      }
    } catch (err) {
      // A bad key or exhausted quota shouldn't kill the import — fall back and
      // let the caller see which path actually ran.
      console.warn('[radio] Data API import failed, falling back to scrape:', err.message);
    }
  }

  const tracks = await fetchViaScrape(playlistId, max);
  return {
    playlistId,
    method: 'scrape',
    tracks,
    truncated: tracks.length >= Math.min(max, SCRAPE_CAP)
  };
}

/* ── Embeddability check ─────────────────────────────────── */

/**
 * Why songs "skip": a rights holder can switch off embedding for an upload.
 * YouTube then refuses to play it anywhere except youtube.com, and the player
 * fires onError. No player setting can override that — the only real fix is to
 * keep those videos out of the playlist.
 *
 * The oEmbed endpoint is the cheap way to tell:
 *   200 → embeddable
 *   400 → no such video
 *   401 → embedding disabled by the uploader
 *   404 → deleted or private
 *
 * Region locks and age restrictions can still bite at playback time (they
 * depend on who is watching), which is what the runtime error reporting is for.
 */
async function checkEmbeddable(videoId) {
  const url = 'https://www.youtube.com/oembed?format=json&url=' +
    encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return { ok: true };
    if (res.status === 400) return { ok: false, reason: 'no such video' };
    if (res.status === 401) return { ok: false, reason: 'embedding disabled' };
    if (res.status === 404) return { ok: false, reason: 'deleted or private' };
    return { ok: true };   // unexpected status — don't throw away a good song
  } catch (e) {
    return { ok: true };   // network hiccup — same
  }
}

/** Splits tracks into the ones that will actually play and the ones that won't. */
async function verifyEmbeddable(tracks, opts = {}) {
  const concurrency = Math.max(1, Math.min(parseInt(opts.concurrency, 10) || 10, 20));
  const playable = [];
  const rejected = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tracks.length) {
      const t = tracks[cursor++];
      const r = await checkEmbeddable(t.videoId);
      if (r.ok) playable.push(t);
      else rejected.push({ ...t, reason: r.reason });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tracks.length) }, worker));

  // Workers finish out of order; restore the playlist's own order.
  const rank = new Map(tracks.map((t, i) => [t.videoId, i]));
  playable.sort((a, b) => rank.get(a.videoId) - rank.get(b.videoId));
  rejected.sort((a, b) => rank.get(a.videoId) - rank.get(b.videoId));

  return { playable, rejected };
}

module.exports = { fetchPlaylist, parsePlaylistId, verifyEmbeddable, checkEmbeddable, SCRAPE_CAP };
