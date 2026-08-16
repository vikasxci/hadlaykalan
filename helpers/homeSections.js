/* Home-page sections the admin can switch on and off, per platform.

   The web and app audiences differ — the app already has push notifications,
   the website has search traffic — so each section is independently targetable.
   Add a key here and to SECTIONS in Frontend/shared/js/sections.js (plus a CSS
   selector in home-media.css) and it becomes manageable end to end. */

const SECTION_KEYS = ['stories', 'mediaSlider', 'radio'];

// A function, not a constant: the value is nested, and a shared reference
// would let one request's edit leak into the next request's defaults.
const SECTION_DEFAULTS = () => ({
  stories:     { web: true, app: true },
  mediaSlider: { web: true, app: true },
  radio:       { web: true, app: true },
});

/* Coerce whatever the panel posts into exactly the shape the frontend expects:
   every known section present, every flag a real boolean. Unknown sections are
   dropped rather than stored, so a typo cannot silently hide something, and a
   missing flag falls back to visible rather than to hidden. */
function sanitizeSections(value) {
  const base = SECTION_DEFAULTS();
  const incoming = (value && typeof value === 'object') ? value : {};
  const out = {};
  for (const key of SECTION_KEYS) {
    const got = (incoming[key] && typeof incoming[key] === 'object') ? incoming[key] : {};
    out[key] = {
      web: got.web === undefined ? base[key].web : !!got.web,
      app: got.app === undefined ? base[key].app : !!got.app,
    };
  }
  return out;
}

module.exports = { SECTION_KEYS, SECTION_DEFAULTS, sanitizeSections };
