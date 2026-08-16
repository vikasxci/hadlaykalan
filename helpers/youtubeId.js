const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/* Admins paste whatever YouTube hands them — a watch URL, a share link, an
   embed URL, a Shorts link, or sometimes just the bare id. Normalise all of it
   to the 11-character id so players never have to guess.
   Returns null for anything that isn't a YouTube link we recognise. */
function extractVideoId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (YT_ID.test(s)) return s;

  let u;
  try {
    // Bare "youtu.be/xyz" has no scheme — URL() would reject it.
    u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
  } catch (e) {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return YT_ID.test(id) ? id : null;
  }
  if (!/^(m\.)?youtube(-nocookie)?\.com$/.test(host)) return null;

  const v = u.searchParams.get('v');
  if (v && YT_ID.test(v)) return v;

  const m = u.pathname.match(/^\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

module.exports = { extractVideoId, YT_ID };
