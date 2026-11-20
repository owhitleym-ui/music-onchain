// Artist photos for real, public artists only. Fictional demo artists keep their initials.
// Photos come from Wikipedia's public page summary (thumbnail), are cached per browser,
// and fall back to initials while loading, offline, or if an image fails.
const WIKIPEDIA_TITLES = Object.freeze({
  'maroon-5': 'Maroon_5',
});

const CACHE_KEY = 'music-artist-photos-v1';
const photos = new Map();
const failed = new Set();

function readCache() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? '{}');
    for (const [id, url] of Object.entries(saved)) if (typeof url === 'string' && url.startsWith('https://')) photos.set(id, url);
  } catch {
    // Storage can be unavailable (private mode); photos simply load again.
  }
}

function writeCache() {
  try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(photos))); } catch { /* optional */ }
}

export function artistPhoto(artistId) {
  return failed.has(artistId) ? null : photos.get(artistId) ?? null;
}

// Royalty-free artwork for fictional artists: a deterministic pattern drawn here (nothing licensed or
// downloaded). Each artist always gets the same design, in the app's navy/coral/gold palette.
function seed(text) {
  let h = 2166136261;
  for (const character of text) { h ^= character.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function artistArt(artist, className = 'art') {
  const h = seed(artist.id);
  const pick = (shift, min, max) => min + ((h >>> shift) % 1000) / 1000 * (max - min);
  const accent = h % 2 ? 'var(--coral)' : 'var(--gold)';
  const ink = 'var(--art-ink)';
  const ground = `fill:color-mix(in srgb, ${artist.color} 55%, var(--art-ground))`;
  let shapes;
  const style = h % 4;
  if (style === 0) { // record: concentric rings
    const cx = pick(3, 70, 110), cy = pick(7, 60, 100);
    shapes = [70, 54, 38].map((r, i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink}" stroke-opacity="${0.16 + i * 0.07}" stroke-width="${i === 2 ? 10 : 2}"/>`).join('')
      + `<circle cx="${cx}" cy="${cy}" r="12" fill="${accent}"/>`;
  } else if (style === 1) { // equalizer bars
    shapes = Array.from({ length: 9 }, (_, i) => {
      const height = 26 + ((h >>> (i * 3)) % 90);
      return `<rect x="${14 + i * 15}" y="${150 - height}" width="9" height="${height}" rx="4.5" fill="${i === 4 ? accent : ink}" fill-opacity="${i === 4 ? 1 : 0.22 + (i % 3) * 0.08}"/>`;
    }).join('');
  } else if (style === 2) { // sound waves
    shapes = [0, 1, 2, 3].map(i => {
      const y = 46 + i * 24, a = pick(i * 4, 10, 22);
      return `<path d="M-10 ${y} C 30 ${y - a}, 50 ${y + a}, 80 ${y} S 130 ${y - a}, 170 ${y}" fill="none" stroke="${i === 1 ? accent : ink}" stroke-opacity="${i === 1 ? 1 : 0.25}" stroke-width="${i === 1 ? 5 : 3}" stroke-linecap="round"/>`;
    }).join('');
  } else { // overlapping circles
    shapes = `<circle cx="${pick(2, 40, 70)}" cy="${pick(6, 50, 80)}" r="46" fill="${ink}" fill-opacity=".18"/>`
      + `<circle cx="${pick(10, 90, 120)}" cy="${pick(14, 80, 110)}" r="40" fill="${accent}" fill-opacity=".85"/>`
      + `<circle cx="${pick(18, 60, 100)}" cy="${pick(22, 100, 130)}" r="22" fill="none" stroke="${ink}" stroke-opacity=".35" stroke-width="3"/>`;
  }
  return `<svg class="${className}" viewBox="0 0 160 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="160" height="160" style="${ground}"/>${shapes}</svg>`;
}

export function artistAvatar(artist, className) {
  const url = artistPhoto(artist.id);
  const initials = `<span class="avatar-initials">${artist.initials}</span>`;
  const media = url ? `<img src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer" data-artist-photo="${artist.id}" />` : artistArt(artist, 'avatar-art');
  return `<span class="${className} has-photo" style="--cover-color:${artist.color}" aria-hidden="true">${initials}${media}</span>`;
}

export function loadArtistPhotos(onUpdate) {
  readCache();
  document.addEventListener('error', event => {
    const id = event.target?.dataset?.artistPhoto;
    if (!id || failed.has(id)) return;
    failed.add(id);
    onUpdate();
  }, true);
  for (const [id, title] of Object.entries(WIKIPEDIA_TITLES)) {
    if (photos.has(id)) continue;
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { Accept: 'application/json' } })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        const url = data?.thumbnail?.source ?? data?.originalimage?.source;
        if (typeof url !== 'string' || !url.startsWith('https://')) return;
        photos.set(id, url);
        writeCache();
        onUpdate();
      })
      .catch(() => { /* keep initials */ });
  }
}
