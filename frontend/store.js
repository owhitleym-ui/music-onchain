import { HOUR, HORIZONS, artists, songs, currentRoundStart, getBaseEntries } from './data.js';

const STORAGE_KEY = 'music-prediction-demo-v1';
let memoryState = null;

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createInitialState(now = Date.now()) {
  const start = currentRoundStart(now) - 12 * 24 * HOUR;
  const examples = [
    { id: 'sample-bonus', songId: 'last-bus-home', horizon: 'week', guess: 31200, costCents: 10000, spots: 10, multiplier: 1.05, result: { mainRank: 1, actual: 31204, baseWinningsCents: 10000, bonusCents: 500, artistFeeCents: 210, appFeeCents: 0, lossCents: 0, returnedCents: 20290, appContributionCents: 500 } },
    { id: 'sample-second', songId: 'animals', horizon: '48h', guess: 53715, costCents: 1000, spots: 1, multiplier: 1, result: { mainRank: 2, actual: 53724, baseWinningsCents: 695, bonusCents: 0, artistFeeCents: 14, appFeeCents: 0, lossCents: 0, returnedCents: 1681, appContributionCents: 0 } },
    { id: 'sample-winner', songId: 'afterglow', horizon: '24h', guess: 38600, costCents: 1000, spots: 1, multiplier: 1, result: { mainRank: 8, actual: 38920, baseWinningsCents: 300, bonusCents: 0, artistFeeCents: 6, appFeeCents: 6, lossCents: 0, returnedCents: 1288, appContributionCents: 0 } },
    { id: 'sample-loss', songId: 'slow-morning', horizon: '48h', guess: 48100, costCents: 1000, spots: 1, multiplier: 1, result: { mainRank: 84, timeRank: 2, timeRankTotal: 6, actual: 43740, baseWinningsCents: 0, bonusCents: 0, artistFeeCents: 0, appFeeCents: 0, lossCents: 200, returnedCents: 800, appContributionCents: 0 } },
    { id: 'sample-neutral', songId: 'paper-moons', horizon: '24h', guess: 9000, costCents: 1000, spots: 1, multiplier: 1, result: { mainRank: 51, actual: 8620, baseWinningsCents: 0, bonusCents: 0, artistFeeCents: 0, appFeeCents: 0, lossCents: 0, returnedCents: 1000, appContributionCents: 0, neutral: true } },
  ];
  return {
    version: 1,
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

function isPurchase(value) {
  if (!value || !songs.some((song) => song.id === value.songId)) return false;
  if (!HORIZONS.some((horizon) => horizon.id === value.horizon)) return false;
  if (typeof value.id !== 'string' || !Number.isSafeInteger(value.guess) || value.guess < 0) return false;
  if (!Number.isSafeInteger(value.roundStart) || value.roundStart % HOUR !== 0 || !Number.isFinite(value.purchasedAt)) return false;
  if (![1000, 10000].includes(value.costCents)) return false;
  const isBundle = value.costCents === 10000;
  if (value.spots !== (isBundle ? 10 : 1) || value.multiplier !== (isBundle ? 1.05 : 1)) return false;
  if (value.status === 'pending') return true;
  if (value.status !== 'completed' || !value.result) return false;
  const result = value.result;
  const amounts = ['actual', 'baseWinningsCents', 'bonusCents', 'artistFeeCents', 'appFeeCents', 'lossCents', 'returnedCents', 'appContributionCents'];
  return Number.isInteger(result.mainRank) && result.mainRank > 0
    && amounts.every((key) => Number.isSafeInteger(result[key]) && result[key] >= 0)
    && result.returnedCents === value.costCents + result.baseWinningsCents + result.bonusCents - result.artistFeeCents - result.appFeeCents - result.lossCents;
}

function validState(value) {
  return value && value.version === 1
    && Number.isSafeInteger(value.balanceCents) && value.balanceCents >= 0
    && ['light', 'dark'].includes(value.theme)
    && Array.isArray(value.follows) && value.follows.every((id) => artists.some((artist) => artist.id === id))
    && Array.isArray(value.purchases) && value.purchases.every(isPurchase)
    && new Set(value.purchases.map((purchase) => purchase.id)).size === value.purchases.length;
}

export function loadState() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      if (validState(state)) {
        memoryState = copy(state);
        return state;
      }
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

export function buyPrediction(state, request, now = Date.now()) {
  const { songId, roundStart, horizon, guess, costCents } = request;
  if (!songs.some((song) => song.id === songId)) throw new Error('Choose a song from the demo.');
  if (!HORIZONS.some((option) => option.id === horizon)) throw new Error('Choose a prediction window.');
  if (!Number.isSafeInteger(guess) || guess < 0) throw new Error('Enter a whole number of views, starting at zero.');
  if (![1000, 10000].includes(costCents)) throw new Error('Choose the $10 or $100 option.');
  if (!Number.isSafeInteger(roundStart) || roundStart % HOUR !== 0 || now < roundStart || now >= roundStart + HOUR) {
    throw new Error('Entries for this round are closed. Open the current round to make a prediction.');
  }
  if (state.balanceCents < costCents) throw new Error('Your demo balance is too low for this purchase.');
  const purchase = {
    id: 'purchase-' + (globalThis.crypto?.randomUUID?.() ?? now + '-' + Math.random().toString(36).slice(2)),
    songId,
    roundStart,
    horizon,
    guess,
    costCents,
    spots: costCents === 10000 ? 10 : 1,
    multiplier: costCents === 10000 ? 1.05 : 1,
    purchasedAt: now,
    status: 'pending',
  };
  state.balanceCents -= costCents;
  state.purchases.unshift(purchase);
  saveState(state);
  return purchase;
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
    totalEnteredCents: spotCount * 1000,
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
