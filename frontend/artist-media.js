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

export function artistAvatar(artist, className) {
  const url = artistPhoto(artist.id);
  const initials = `<span class="avatar-initials">${artist.initials}</span>`;
  return `<span class="${className} ${url ? 'has-photo' : ''}" style="--cover-color:${artist.color}" aria-hidden="true">${initials}${url ? `<img src="${url}" alt="" loading="lazy" referrerpolicy="no-referrer" data-artist-photo="${artist.id}" />` : ''}</span>`;
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
