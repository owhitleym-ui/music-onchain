import { HOUR, HORIZONS, artists, songs, currentRoundStart, getBaseEntries } from './data.js';
import { SPOT_PRICE_CENTS, BUNDLE_PRICE_CENTS, BUNDLE_SPOTS, BUNDLE_MULTIPLIER, ENTRY_PRICES_CENTS } from './pricing.js';

const STORAGE_KEY = 'music-prediction-demo-v1';
export const PURCHASES_PAUSED = 'Purchases are not available in this preview.';
let memoryState = null;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createInitialState(now = Date.now()) {
  const start = currentRoundStart(now) - 12 * 24 * HOUR;
  const examples = [
    { id: 'sample-bonus', songId: 'last-bus-home', horizon: 'week', guess: 31200, costCents: BUNDLE_PRICE_CENTS, spots: BUNDLE_SPOTS, multiplier: BUNDLE_MULTIPLIER, result: { mainRank: 1, actual: 31204, baseWinningsCents: 5000, bonusCents: 250, artistFeeCents: 105, appFeeCents: 0, lossCents: 0, returnedCents: 10145, appContributionCents: 250 } },
    { id: 'sample-second', songId: 'animals', horizon: '48h', guess: 53715, costCents: SPOT_PRICE_CENTS, spots: 1, multiplier: 1, result: { mainRank: 2, actual: 53724, baseWinningsCents: 348, bonusCents: 0, artistFeeCents: 7, appFeeCents: 0, lossCents: 0, returnedCents: 841, appContributionCents: 0 } },
    { id: 'sample-winner', songId: 'afterglow', horizon: '24h', guess: 38600, costCents: SPOT_PRICE_CENTS, spots: 1, multiplier: 1, result: { mainRank: 8, actual: 38920, baseWinningsCents: 150, bonusCents: 0, artistFeeCents: 3, appFeeCents: 3, lossCents: 0, returnedCents: 644, appContributionCents: 0 } },
    { id: 'sample-loss', songId: 'slow-morning', horizon: '48h', guess: 48100, costCents: SPOT_PRICE_CENTS, spots: 1, multiplier: 1, result: { mainRank: 84, timeRank: 2, timeRankTotal: 6, actual: 43740, baseWinningsCents: 0, bonusCents: 0, artistFeeCents: 0, appFeeCents: 0, lossCents: 100, returnedCents: 400, appContributionCents: 0 } },
    { id: 'sample-neutral', songId: 'paper-moons', horizon: '24h', guess: 9000, costCents: SPOT_PRICE_CENTS, spots: 1, multiplier: 1, result: { mainRank: 51, actual: 8620, baseWinningsCents: 0, bonusCents: 0, artistFeeCents: 0, appFeeCents: 0, lossCents: 0, returnedCents: 500, appContributionCents: 0, neutral: true } },
  ];
  return {
    version: 2,
    balanceCents: 100000,
    follows: ['maya-lane', 'northline'],
    theme: 'light',
    purchases: examples.map((example, index) => ({
      ...example,
      roundStart: start - index * 3 * HOUR,
      purchasedAt: start - index * 3 * HOUR + 6 * 60 * 1000,
      status: 'completed',
    })),
  };
}

function isPurchase(value, version) {
  if (!value || !songs.some((song) => song.id === value.songId)) return false;
  if (!HORIZONS.some((horizon) => horizon.id === value.horizon)) return false;
  if (typeof value.id !== 'string' || !Number.isSafeInteger(value.guess) || value.guess < 0) return false;
  if (!Number.isSafeInteger(value.roundStart) || value.roundStart % HOUR !== 0 || !Number.isFinite(value.purchasedAt)) return false;
  const prices = version === 1 ? [1000, 10000] : [SPOT_PRICE_CENTS, BUNDLE_PRICE_CENTS];
  if (!prices.includes(value.costCents)) return false;
  const isBundle = value.costCents === prices[1];
  if (value.spots !== (isBundle ? BUNDLE_SPOTS : 1) || value.multiplier !== (isBundle ? BUNDLE_MULTIPLIER : 1)) return false;
  if (value.status === 'pending') return true;
  if (value.status !== 'completed' || !value.result) return false;
  const result = value.result;
  const amounts = ['actual', 'baseWinningsCents', 'bonusCents', 'artistFeeCents', 'appFeeCents', 'lossCents', 'returnedCents', 'appContributionCents'];
  return Number.isInteger(result.mainRank) && result.mainRank > 0
    && amounts.every((key) => Number.isSafeInteger(result[key]) && result[key] >= 0)
    && result.returnedCents === value.costCents + result.baseWinningsCents + result.bonusCents - result.artistFeeCents - result.appFeeCents - result.lossCents;
}

function validState(value, version) {
  return value && value.version === version
    && Number.isSafeInteger(value.balanceCents) && value.balanceCents >= 0
    && ['light', 'dark'].includes(value.theme)
    && Array.isArray(value.follows) && value.follows.every((id) => artists.some((artist) => artist.id === id))
    && Array.isArray(value.purchases) && value.purchases.every(purchase => isPurchase(purchase, version))
    && new Set(value.purchases.map((purchase) => purchase.id)).size === value.purchases.length;
}

function migrateLegacyState(value) {
  if (!validState(value, 1)) return null;
  const migrated = copy(value);
  migrated.version = 2;
  for (const purchase of migrated.purchases) {
    purchase.costCents = Math.round(purchase.costCents / 2);
    if (!purchase.result) continue;
    const result = purchase.result;
    for (const key of ['baseWinningsCents', 'bonusCents', 'lossCents', 'appContributionCents']) {
      result[key] = Math.round(result[key] / 2);
    }
    const winnings = result.baseWinningsCents + result.bonusCents;
    result.artistFeeCents = Math.round(winnings * .02);
    result.appFeeCents = result.mainRank <= 2 ? 0 : Math.round(winnings * .02);
    result.returnedCents = purchase.costCents + winnings - result.lossCents - result.artistFeeCents - result.appFeeCents;
  }
  return validState(migrated, 2) ? migrated : null;
}

export function loadState() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      if (validState(state, 2)) {
        memoryState = copy(state);
        return state;
      }
      const migrated = migrateLegacyState(state);
      if (migrated) return saveState(migrated);
    }
  } catch {
    // The demo can still run when browser storage is unavailable.
  }
  return memoryState ? copy(memoryState) : createInitialState();
}

export function saveState(state) {
  memoryState = copy(state);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the current demo session usable if the browser blocks persistence.
  }
  return state;
}

export function toggleFollow(state, artistId) {
  if (!artists.some((artist) => artist.id === artistId)) throw new Error('Choose an artist from the demo.');
  const index = state.follows.indexOf(artistId);
  if (index === -1) state.follows.push(artistId);
  else state.follows.splice(index, 1);
  saveState(state);
  return state.follows.includes(artistId);
}

export function setTheme(state, theme) {
  if (!['light', 'dark'].includes(theme)) throw new Error('Choose a light or dark theme.');
  state.theme = theme;
  saveState(state);
}

// Payments are disabled at the action boundary as well as in the UI.
export function buyPrediction() {
  throw new Error(PURCHASES_PAUSED);
}

export function getRoundSummary(state, songId, roundStart, horizon) {
  const local = state.purchases
    .filter((purchase) => purchase.songId === songId && purchase.roundStart === roundStart && purchase.horizon === horizon)
    .map((purchase) => ({ ...purchase, personId: 'demo-user' }));
  const entries = [...getBaseEntries(songId, roundStart, horizon), ...local];
  const counts = new Map();
  let spotCount = 0;
  let totalGuesses = 0;
  for (const entry of entries) {
    spotCount += entry.spots;
    totalGuesses += entry.guess * entry.spots;
    counts.set(entry.guess, (counts.get(entry.guess) ?? 0) + entry.spots);
  }
  const popular = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return {
    average: spotCount ? totalGuesses / spotCount : 0,
    mode: popular[0]?.[0] ?? 0,
    modeSpots: popular[0]?.[1] ?? 0,
    spotCount,
    peopleCount: new Set(entries.map((entry) => entry.personId)).size,
    totalEnteredCents: spotCount * SPOT_PRICE_CENTS,
  };
}

export function getPortfolio(state) {
  const completed = state.purchases.filter((purchase) => purchase.status === 'completed');
  const supported = state.purchases.map((purchase) => songs.find((song) => song.id === purchase.songId)?.artistId).filter(Boolean);
  return {
    supportedArtists: new Set(supported).size,
    netProfitCents: completed.reduce((sum, purchase) => sum + purchase.result.returnedCents - purchase.costCents, 0),
    totalReturnedCents: completed.reduce((sum, purchase) => sum + purchase.result.returnedCents, 0),
    artistFeesCents: completed.reduce((sum, purchase) => sum + purchase.result.artistFeeCents, 0),
  };
}

export function getPurchaseStatus(purchase, now = Date.now()) {
  if (purchase.status === 'completed') return 'completed';
  const horizon = HORIZONS.find((option) => option.id === purchase.horizon);
  return horizon && now >= purchase.roundStart + horizon.endHours * HOUR ? 'awaiting' : 'pending';
}
