// Artist photos for real, public artists only. Fictional demo artists keep their initials.
// Photos come from Wikipedia's public page summary (thumbnail), are cached per browser,
// and fall back to initials while loading, offline, or if an image fails.
// Add 'artist-id': 'Wikipedia_Title' here to show a real artist's photo. Empty: every artist uses artwork.
const WIKIPEDIA_TITLES = Object.freeze({});

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

// Calm blue/green hues; each artist gets one hue, drawn as low-contrast tints of itself.
const HUES = ['#2456a6', '#2f6f9f', '#1f7a8c', '#0f7f74', '#2c7a5b', '#3d6fb0', '#1d6b84'];

export function artistArt(artist, className = 'art') {
  const h = seed(artist.id);
  const pick = (shift, min, max) => min + ((h >>> shift) % 1000) / 1000 * (max - min);
  const hue = HUES[h % HUES.length];
  const ground = `fill:color-mix(in srgb, ${hue} 14%, var(--surface))`;
  const tone = opacity => `stroke="${hue}" stroke-opacity="${opacity}"`;
  let shapes;
  const style = (h >>> 5) % 4;
  if (style === 0) { // record rings
    const cx = pick(3, 80, 120), cy = pick(7, 70, 100);
    shapes = [64, 48, 32].map((r, i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" ${tone(0.14 + i * 0.06)} stroke-width="${i === 2 ? 7 : 2}"/>`).join('')
      + `<circle cx="${cx}" cy="${cy}" r="9" fill="${hue}" fill-opacity=".38"/>`;
  } else if (style === 1) { // equalizer bars
    shapes = Array.from({ length: 9 }, (_, i) => {
      const height = 24 + ((h >>> (i * 3)) % 70);
      return `<rect x="${14 + i * 15}" y="${150 - height}" width="8" height="${height}" rx="4" fill="${hue}" fill-opacity="${0.14 + (i % 3) * 0.06}"/>`;
    }).join('');
  } else if (style === 2) { // sound waves
    shapes = [0, 1, 2, 3].map(i => {
      const y = 50 + i * 22, a = pick(i * 4, 8, 18);
      return `<path d="M-10 ${y} C 30 ${y - a}, 50 ${y + a}, 80 ${y} S 130 ${y - a}, 170 ${y}" fill="none" ${tone(i === 1 ? 0.42 : 0.18)} stroke-width="${i === 1 ? 3.5 : 2.5}" stroke-linecap="round"/>`;
    }).join('');
  } else { // soft overlapping circles
    shapes = `<circle cx="${pick(2, 40, 70)}" cy="${pick(6, 50, 80)}" r="44" fill="${hue}" fill-opacity=".12"/>`
      + `<circle cx="${pick(10, 90, 120)}" cy="${pick(14, 80, 110)}" r="36" fill="${hue}" fill-opacity=".2"/>`
      + `<circle cx="${pick(18, 60, 100)}" cy="${pick(22, 100, 130)}" r="20" fill="none" ${tone(0.3)} stroke-width="2.5"/>`;
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
