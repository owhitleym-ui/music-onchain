import { BUNDLE_SPOTS } from './pricing.js';

export const HOUR = 60 * 60 * 1000;

export const HORIZONS = [
  { id: '24h', label: '24h', startHours: 0, endHours: 24 },
  { id: '48h', label: '48h', startHours: 24, endHours: 48 },
  { id: 'week', label: '1 week', startHours: 144, endHours: 168 },
];

export const artists = [
  { id: 'maroon-5', name: 'Maroon 5', genre: 'Pop', initials: 'M5', color: '#d4dbea', bio: 'Explore the music behind the moment. This is an illustrative artist profile with sample contest data.' },
  { id: 'maya-lane', name: 'Maya Lane', genre: 'Indie', initials: 'ML', color: '#c8d6f0', bio: 'Late-night melodies and stories from the last ride home. Maya is a fictional independent artist in this demo.' },
  { id: 'june-park', name: 'June Park', genre: 'R&B', initials: 'JP', color: '#e8d1c9', bio: 'Soft vocals, warm bass, and the feeling of taking your time. June is a fictional artist in this demo.' },
  { id: 'northline', name: 'Northline', genre: 'Electronic', initials: 'NL', color: '#c9dedb', bio: 'Electronic music for open roads and bright city lights. Northline is a fictional project in this demo.' },
  { id: 'elio', name: 'Elio', genre: 'Pop', initials: 'E', color: '#ebd8ab', bio: 'A songwriter chasing small moments and big choruses. Elio is a fictional artist in this demo.' },
  { id: 'olive-reed', name: 'Olive Reed', genre: 'Folk', initials: 'OR', color: '#d5dcc1', bio: 'Acoustic songs drawn from the everyday. Olive is a fictional independent artist in this demo.' },
  { id: 'atlas-blue', name: 'Atlas Blue', genre: 'Indie', initials: 'AB', color: '#cbd8e2', bio: 'Guitar music about new places and familiar people. Atlas Blue is a fictional band in this demo.' },
  { id: 'rae-sol', name: 'Rae Sol', genre: 'R&B', initials: 'RS', color: '#e9c5b1', bio: 'Soulful sketches, recorded one room at a time. Rae is a fictional independent artist in this demo.' },
  { id: 'milo-west', name: 'Milo West', genre: 'Pop', initials: 'MW', color: '#d9d1e8', bio: 'Pop songs that turn a quiet afternoon into something memorable. Milo is a fictional artist in this demo.' },
  { id: 'sora', name: 'Sora', genre: 'Electronic', initials: 'S', color: '#badcdd', bio: 'Dreamy textures and a beat that carries you somewhere else. Sora is a fictional artist in this demo.' },
  { id: 'ella-bloom', name: 'Ella Bloom', genre: 'Folk', initials: 'EB', color: '#e5d6c1', bio: 'Honest words, a well-traveled guitar, and a window left open. Ella is a fictional artist in this demo.' },
];

export const songs = [
  { id: 'animals', title: 'Animals', artistId: 'maroon-5', dailyViews: 50040, growth: 12.8, category: 'popular' },
  { id: 'last-bus-home', title: 'Last Bus Home', artistId: 'maya-lane', dailyViews: 28420, growth: 34.2, category: 'popular' },
  { id: 'slow-morning', title: 'Slow Morning', artistId: 'june-park', dailyViews: 41280, growth: 16.6, category: 'popular' },
  { id: 'afterglow', title: 'Afterglow', artistId: 'northline', dailyViews: 36750, growth: 22.4, category: 'popular' },
  { id: 'golden-hour', title: 'Golden Hour', artistId: 'elio', dailyViews: 32680, growth: 18.9, category: 'popular' },
  { id: 'paper-moons', title: 'Paper Moons', artistId: 'olive-reed', dailyViews: 8400, growth: 68.2, category: 'rising' },
  { id: 'different-roads', title: 'Different Roads', artistId: 'atlas-blue', dailyViews: 12650, growth: 57.4, category: 'rising' },
  { id: 'stay-awhile', title: 'Stay Awhile', artistId: 'rae-sol', dailyViews: 11320, growth: 46.8, category: 'rising' },
  { id: 'blue-sky', title: 'Blue Sky', artistId: 'milo-west', dailyViews: 9680, growth: 42.3, category: 'rising' },
  { id: 'neon-rain', title: 'Neon Rain', artistId: 'sora', dailyViews: 14820, growth: 74.1, category: 'rising' },
  { id: 'wildflowers', title: 'Wildflowers', artistId: 'ella-bloom', dailyViews: 7250, growth: 39.5, category: 'rising' },
  { id: 'daylight', title: 'Daylight', artistId: 'maya-lane', dailyViews: 10480, growth: 51.6, category: 'rising' },
  { id: 'in-between', title: 'In Between', artistId: 'june-park', dailyViews: 6360, growth: 36.8, category: 'rising' },
];

export function currentRoundStart(now = Date.now()) {
  return Math.floor(now / HOUR) * HOUR;
}

function hash(text) {
  let value = 0;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value;
}

export function getHistory(songId, roundStart, days) {
  const song = songs.find((item) => item.id === songId);
  if (!song || !Number.isFinite(roundStart)) return [];
  const duration = [3, 7, 30].includes(days) ? days : 7;
  const phase = hash(songId) % 30;
  return Array.from({ length: duration * 4 + 1 }, (_, index) => {
    const daysAgo = duration - index / 4;
    const trend = Math.exp(-daysAgo * Math.log1p(song.growth / 100) / 7);
    const wave = 1 + 0.065 * (Math.sin(phase - daysAgo * 2.2) - Math.sin(phase));
    return {
      time: roundStart - daysAgo * 24 * HOUR,
      views: Math.max(1, Math.round(song.dailyViews * trend * wave)),
    };
  });
}

export function getBaseEntries(songId, roundStart, horizon) {
  const song = songs.find((item) => item.id === songId);
  if (!song || !HORIZONS.some((item) => item.id === horizon)) return [];
  const seed = hash(songId + ':' + roundStart + ':' + horizon);
  const multiplier = { '24h': 1.025, '48h': 1.075, week: 1.14 }[horizon];
  const center = Math.round(song.dailyViews * multiplier / 5) * 5;
  const offsets = [0, 0, 0, 0, -0.16, -0.12, -0.08, -0.05, -0.03, -0.01, 0.02, 0.04, 0.06, 0.09, 0.12, 0.15, 0.19, 0.23, -0.22, 0.3];
  return offsets.map((offset, index) => ({
    id: 'crowd-' + index,
    personId: 'listener-' + ((index + seed) % 17),
    guess: Math.max(0, Math.round(center * (1 + offset))),
    spots: index % 6 === seed % 6 ? BUNDLE_SPOTS : 1,
    purchasedAt: roundStart + ((index * 97 + seed % 100) % 1200) * 1000,
  }));
}
