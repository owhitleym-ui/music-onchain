import {payments,paymentOption} from './payments.js';
import {accountPurchaseMarkup,orderModal,entryModal,nativeDollars} from './payment-ui.js';
import {liveCount,liveAverage,freshness} from './live-format.js';
import { HOUR, HORIZONS, artists, songs, currentRoundStart, getHistory } from './data.js';
import { createInitialState, loadState, saveState, toggleFollow, setTheme, PURCHASES_PAUSED, getRoundSummary, getPortfolio, getPurchaseStatus } from './store.js';
import { icon } from './icons.js';
import { artistAvatar, artistArt, artistPhoto, loadArtistPhotos } from './artist-media.js';
import { PHOTO_CREDITS, FEATURE_IMAGE } from './artist-images.js';
import { renderChart, renderRewardCurve } from './chart.js';
import { account } from './account.js';
import { formatDollars, formatAccountDollars } from './money.js';
import { SPOT_PRICE_CENTS, BUNDLE_PRICE_CENTS, BUNDLE_SPOTS, BUNDLE_MULTIPLIER, ENTRY_PRICES_CENTS } from './pricing.js';

let state = loadState();
const ui = {
  search: '', genre: 'all', followedOnly: false, filtersOpen: false,
  historyDays: 3, amount: SPOT_PRICE_CENTS, guess: '', formError: '',
  lastSong: 'animals', lastContext: '', modal: null, settingsOpen: false,
  purchaseSort: 'newest', followSort: 'recent', lastView: '', expandedSection: '', outcomeFilter: 'all',
};
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const settingsRoot = document.querySelector('#settings-root');
const artistFor = song => artists.find(artist => artist.id === song.artistId);
const horizonFor = id => HORIZONS.find(horizon => horizon.id === id) || HORIZONS[0];
const money = formatDollars;
const number = (value, decimals = 0) => value == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : value);
const signedMoney = cents => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
const profitClass = cents => cents > 0 ? 'positive' : cents < 0 ? 'negative' : 'muted';
const esc = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

function dateTime(time, full = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(full ? { year: 'numeric' } : {}), timeZone: 'America/Chicago',
  }).format(time);
}

function measurement(roundStart, horizonId) {
  const horizon = horizonFor(horizonId);
  return `${dateTime(roundStart + horizon.startHours * HOUR)} → ${dateTime(roundStart + horizon.endHours * HOUR)} CT`;
}

function countdown(end) {
  const seconds = Math.max(0, Math.floor((end - payments.serverNow()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function route() {
  const [page = 'discover', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const songId = params.get('song') || ui.lastSong;
  const song = songs.find(item => item.id === songId) || songs[0];
  let roundStart=currentRoundStart(),liveRoundId=null;
  if(song.id==='last-bus-home') {
    const rounds=payments.getState().catalog?.rounds??[];
    const chosen=params.has('roundId')?rounds.find(r=>r.id===params.get('roundId'))
      :params.has('round')?rounds.find(r=>r.start===Number(params.get('round'))):payments.currentRound();
    roundStart=chosen?.start??null;liveRoundId=chosen?.id??null;
  } else {
    const value=Number(params.get('round'));
    if(params.has('round')&&Number.isSafeInteger(value)&&value%HOUR===0&&value<=currentRoundStart())roundStart=value;
  }
  return {page:['discover','support','purchases'].includes(page)?page:'discover',song,roundStart,liveRoundId,
    horizon:horizonFor(params.get('horizon')).id,tab:params.get('tab')==='subscribed'?'subscribed':'all'};
}

function songLink(songId,horizon='24h',roundStart=currentRoundStart()) {
  if(songId==='last-bus-home') {
    const chosen=payments.getState().catalog?.rounds?.find(r=>r.start===roundStart)||payments.currentRound();
    return `#support?song=last-bus-home${chosen?'&roundId='+encodeURIComponent(chosen.id):''}&horizon=${horizon}`;
  }
  return `#support?song=${encodeURIComponent(songId)}&round=${roundStart}&horizon=${horizon}`;
}

function followButton(artist, className = 'button secondary small', showText = true) {
  const followed = state.follows.includes(artist.id);
  return `<button type="button" class="${className} ${followed ? 'is-followed' : ''}" data-action="follow" data-artist="${artist.id}" aria-pressed="${followed}" aria-label="${followed ? 'Unfollow' : 'Follow'} ${esc(artist.name)}" title="${followed ? 'Following' : 'Follow'} ${esc(artist.name)}">${icon(followed ? 'check' : 'heart')}${showText ? `<span>${followed ? 'Following' : 'Follow artist'}</span>` : ''}</button>`;
}

function renderHeader(page) {
  return `<header class="site-header"><div class="header-inner">
    <a class="brand" href="#discover" aria-label="ampramp home"><img class="brand-mark-img brand-logo-light" src="/brand/ampramp-mark.svg" alt="" width="28" height="28" /><img class="brand-mark-img brand-logo-dark" src="/brand/ampramp-mark-dark.svg" alt="" width="28" height="28" /><span class="brand-name">ampramp</span></a>
    <nav class="main-nav" aria-label="Main navigation">
      <a href="#discover" class="${page !== 'purchases' ? 'active' : ''}" ${page === 'discover' ? 'aria-current="page"' : ''}>${icon('compass')}Discover</a>
      <a href="#purchases?tab=subscribed" class="${page === 'purchases' ? 'active' : ''}" ${page === 'purchases' ? 'aria-current="page"' : ''}>${icon('receipt')}My Purchases</a>
    </nav>
    <div class="header-actions"><span class="demo-badge">Demo — no real money</span>
      <span id="header-account">${accountHeaderContent()}</span>
      <button class="button secondary settings-button" data-action="settings" aria-haspopup="dialog" aria-controls="settings-panel" aria-expanded="${ui.settingsOpen}">${icon('settings')}<span>Settings</span></button>
    </div>
  </div></header>`;
}

let settingsTrigger = null;
let returnToSettings = false;
let returnFromLogin = false;

function accountHeaderContent() {
  const current = account.getState();
  if (current.authenticated) return `<button class="button secondary account-header-button" data-action="settings" aria-label="Open account settings for ${esc(current.email || 'your account')}">${icon('user')}<span>${esc(current.email || 'My account')}</span></button>`;
  const loading = !current.ready && !current.error;
  const waiting = current.busy === 'login' || current.busy === 'logout';
  return `<button class="button primary account-sign-in" data-action="account-login" ${loading || waiting ? 'disabled' : ''}>${loading ? 'Loading account…' : current.busy === 'logout' ? 'Signing out…' : waiting ? 'Signing in…' : 'Sign up / Log in'}</button>`;
}

function activationContent(current) {
  if (!current.address) return '';
  const status = current.approvalStatus;
  const label = status === 'approved' ? 'Account approved' : status === 'revoked' ? 'Account activation disabled'
    : status === 'error' ? 'Account activation needs attention' : current.approvalCanRetry ? 'Account activation is taking longer than expected' : 'Activating your account…';
  return `<div class="account-activation ${status === 'approved' ? 'is-approved' : ''}"><p role="status" aria-live="polite">${status === 'approved' ? icon('check') : ''}${esc(label)}</p>${current.approvalError ? `<p class="settings-hint">${esc(current.approvalError)}</p>` : ''}${current.approvalCanRetry ? '<button class="button secondary small" data-action="account-retry-approval">Try activation again</button>' : ''}</div>`;
}

function accountContent() {
  const current = account.getState();
  const error = current.error ? `<p class="account-error" role="alert">${esc(current.error)}</p>` : '';
  if (!current.authenticated) {
    const loading = !current.ready && !current.error;
    return `<div class="account-card" tabindex="-1"><div class="account-empty-icon">${icon('user')}</div><h4>Your next great discovery starts here.</h4><p class="settings-hint">Sign up or log in with your email. We’ll send you a code, so there’s no password to remember.</p><button class="button primary full-width" data-action="account-login" ${loading || current.busy ? 'disabled' : ''}>${loading ? 'Loading account…' : current.busy === 'logout' ? 'Signing out…' : current.busy ? 'Signing in…' : 'Sign up / Log in'}</button>${error}${!current.ready && current.error ? '<button class="text-button account-reload" data-action="account-reload">Reload and try again</button>' : ''}<p class="settings-hint">You can explore songs and sample predictions without an account.</p></div>`;
  }
  const settingUp = ['creating', 'restoring'].includes(current.setupStatus);
  const balance = current.balanceStatus === 'ready' && current.balance !== null ? formatAccountDollars(current.balance) : settingUp ? 'Setting up…' : current.balanceStatus === 'loading' ? 'Loading…' : 'Unavailable';
  return `<div class="account-card" tabindex="-1"><p class="account-verified">${icon('check')} Email verified</p><h4 class="account-email">${esc(current.email || 'Your account')}</h4>
    <p class="account-balance-label">Account balance</p><div class="account-balance" role="status" aria-live="polite">${esc(balance)}</div><p class="account-demo-note">Demo dollars · no cash value</p>
    ${settingUp ? '<p class="settings-hint" role="status">We’re finishing your account setup. This may take a moment.</p>' : ''}
    ${current.updatedAt && current.balanceStatus === 'ready' ? `<p class="settings-hint">Updated ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(current.updatedAt)}</p>` : ''}
    ${activationContent(current)}${error}${current.balanceError ? `<p class="account-error" role="alert">${esc(current.balanceError)}</p>` : ''}
    <div class="account-actions">${current.setupStatus === 'error' ? `<button class="button primary" data-action="account-retry-setup" ${current.busy ? 'disabled' : ''}>Try account setup again</button>` : `<button class="button secondary" data-action="account-refresh" ${!current.address || current.balanceStatus === 'loading' ? 'disabled' : ''}>${icon('reset')}${current.balanceStatus === 'loading' ? 'Refreshing…' : 'Refresh'}</button>`}<button class="button secondary" data-action="account-logout" ${current.busy === 'logout' ? 'disabled' : ''}>Sign out</button></div>
    ${current.setupStatus === 'error' ? '<button class="text-button account-reload" data-action="account-reload">Reload account</button>' : ''}
    <p class="settings-hint">Sample purchases below are separate from your account balance.</p></div>`;
}

function refreshAccountUI(current = account.getState()) {
  const focused = document.activeElement;
  const header = document.querySelector('#header-account');
  if (header) {
    const hadFocus = header.contains(focused);
    header.innerHTML = accountHeaderContent();
    if (hadFocus) (header.querySelector('button:not([disabled])') || document.querySelector('[data-action="settings"]'))?.focus({ preventScroll: true });
  }
  const container = settingsRoot.querySelector('#settings-account');
  if (container) {
    const hadFocus = container.contains(focused);
    const action = hadFocus ? focused.dataset.action : null;
    container.innerHTML = accountContent();
    if (hadFocus) (container.querySelector(`[data-action="${action}"]:not([disabled])`) || container.querySelector('.account-card')).focus({ preventScroll: true });
  }
  if (returnFromLogin && !current.dialogOpen && current.busy !== 'login') {
    returnFromLogin = false;
    queueMicrotask(() => {
      if (!ui.modal && !ui.settingsOpen && !account.getState().dialogOpen) {
        document.querySelector('#header-account button:not([disabled])')?.focus({ preventScroll: true });
      }
    });
  }
}

function appearanceContent() {
  return `<p class="settings-hint">Choose what feels comfortable.</p><button class="button secondary settings-theme-control" data-action="theme" aria-label="Switch to ${state.theme === 'light' ? 'dark' : 'light'} mode">${icon(state.theme === 'light' ? 'moon' : 'sun')}Use ${state.theme === 'light' ? 'dark' : 'light'} mode</button>`;
}

function openSettings(trigger) {
  if (ui.settingsOpen) return;
  settingsTrigger = trigger?.matches('button') ? trigger : document.querySelector('.settings-button');
  ui.settingsOpen = true;
  settingsTrigger?.setAttribute('aria-expanded', 'true');
  settingsRoot.innerHTML = `<div class="settings-backdrop" data-action="settings-backdrop"><section id="settings-panel" class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1"><div class="settings-header"><h2 id="settings-title">Settings</h2><button class="icon-button" data-action="close-settings" aria-label="Close settings">${icon('close')}</button></div><div class="settings-content"><section class="settings-section"><div class="settings-section-heading">${icon('user')}<h3>Account</h3></div><div id="settings-account">${accountContent()}</div></section><section class="settings-section"><div class="settings-section-heading">${icon('sun')}<h3>Appearance</h3></div><div id="settings-appearance">${appearanceContent()}</div></section><section class="settings-section settings-demo-section"><h3>Demo data</h3><p class="settings-hint">Restore sample purchases, followed artists, and the light theme. Your account and balance stay as they are.</p><button class="button secondary" data-action="reset">${icon('reset')}Reset demo</button></section></div></section></div>`;
  app.inert = true;
  document.body.style.overflow = 'hidden';
  settingsRoot.querySelector('[data-action="close-settings"]').focus();
  account.setPanelOpen(true);
}

function closeSettings(restoreFocus = true) {
  if (!ui.settingsOpen) return;
  ui.settingsOpen = false;
  account.setPanelOpen(false);
  settingsRoot.innerHTML = '';
  app.inert = Boolean(ui.modal);
  if (!ui.modal) document.body.style.overflow = '';
  const trigger = settingsTrigger?.isConnected ? settingsTrigger : document.querySelector('[data-action="settings"]');
  trigger?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) trigger?.focus();
}

function cover(song, small = false) {
  const artist = artistFor(song);
  const photo = artistPhoto(artist.id);
  return `<div class="song-cover ${small ? 'small-cover' : ''} ${photo ? 'has-photo' : ''}" style="--cover-color:${artist.color}" aria-hidden="true">${photo ? `<img class="cover-photo" src="${photo}" alt="" loading="lazy" referrerpolicy="no-referrer" data-artist-photo="${artist.id}" />` : artistArt(artist, 'cover-art')}<span class="cover-mark">${esc(artist.initials)}</span><span class="cover-lines"><i></i><i></i><i></i><i></i><i></i></span>${small ? '' : `<span class="cover-caption">${esc(song.title)}</span>`}</div>`;
}

function songCard(song, index) {
  const artist = artistFor(song);
  const liveCard=song.id==='last-bus-home';
  let summary=liveCard?{spotCount:null}:getRoundSummary(state,song.id,currentRoundStart(),'24h');
  if(liveCard) {
    const r=payments.currentRound(),p=r?payments.getState().pools[r.id+':24h']:null;
    summary={spotCount:p?.spotCount??null};
  }
  return `<article class="song-card" data-action="open-song" data-song="${song.id}">
    <div class="cover-container"><a href="${songLink(song.id)}" aria-label="Predict views for ${esc(song.title)}">${cover(song)}</a>${isLive(song) ? '<span class="card-number live-tag">Live test</span>' : ''}${followButton(artist, 'card-follow', false)}</div>
    <div class="song-card-body"><a class="song-title" href="${songLink(song.id)}">${esc(song.title)}</a><div class="song-artist">${esc(artist.name)}</div>
      <div class="song-stats"><div><span class="stat-value">${number(song.dailyViews)}</span><span class="stat-label">daily video views</span></div><span class="growth">${icon('trend')}${song.growth}%</span></div>
      <div class="card-bottom"><span class="genre-tag">${esc(artist.genre)}</span><a class="card-open" href="${songLink(song.id)}" aria-label="Open ${esc(song.title)} contest">${liveCard?'Test round · ':''}${summary.spotCount==null?'—':number(summary.spotCount)} spots ${icon('arrow')}</a></div>
    </div></article>`;
}

function filteredSongs() {
  const query = ui.search.toLocaleLowerCase().trim();
  return songs.filter(song => {
    const artist = artistFor(song);
    return `${song.title} ${artist.name}`.toLocaleLowerCase().includes(query)
      && (ui.genre === 'all' || artist.genre === ui.genre)
      && (!ui.followedOnly || state.follows.includes(artist.id));
  });
}

function emptyState(title, description, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${icon('music')}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;
}

const isLive = song => song.id === 'last-bus-home';

function recommendedSongs() {
  // Simple, explainable recommendations: favour genres and artists you follow, then momentum.
  const followedGenres = new Set(artists.filter(a => state.follows.includes(a.id)).map(a => a.genre));
  const score = song => {
    const artist = artistFor(song);
    return (followedGenres.has(artist.genre) ? 40 : 0) + (state.follows.includes(artist.id) ? 15 : 0) + song.growth + (isLive(song) ? 25 : 0);
  };
  return [...songs].sort((a, b) => score(b) - score(a));
}

function discoverSections() {
  const followedNames = artists.filter(a => state.follows.includes(a.id)).map(a => a.name);
  return [
    { id: 'for-you', title: 'Recommended for you', note: followedNames.length ? `Based on ${followedNames.slice(0, 2).join(' and ')}${followedNames.length > 2 ? ' and more' : ''}` : 'Based on momentum across the catalogue', songs: recommendedSongs() },
    { id: 'trending', title: 'Trending now', note: 'Most watched today', songs: [...songs].sort((a, b) => b.dailyViews - a.dailyViews) },
    { id: 'rising', title: 'Rising early', note: 'Fastest growth this week, smaller artists first', songs: [...songs].sort((a, b) => (a.dailyViews < 12000 ? 0 : 1) - (b.dailyViews < 12000 ? 0 : 1) || b.growth - a.growth) },
  ];
}

function rowControls(id, label, seeAll = true) {
  return `<div class="row-controls"><button class="icon-button row-arrow-button" data-action="row-scroll" data-row="${id}" data-dir="-1" aria-label="Scroll ${label} left">${icon('back')}</button><button class="icon-button row-arrow-button" data-action="row-scroll" data-row="${id}" data-dir="1" aria-label="Scroll ${label} right">${icon('arrow')}</button>${seeAll ? `<button class="text-button see-all" data-action="see-all" data-section="${id}">See all</button>` : ''}</div>`;
}

function songRow(section) {
  return `<section class="song-section" aria-labelledby="row-${section.id}"><div class="section-heading"><div><h2 class="section-title" id="row-${section.id}">${section.title}</h2><span class="section-note">${esc(section.note)}</span></div>${rowControls(section.id, section.title)}</div>
    <div class="song-grid song-row" data-row-track="${section.id}">${section.songs.map(songCard).join('')}</div></section>`;
}

function artistTile(artist) {
  const own = songs.filter(song => song.artistId === artist.id);
  return `<article class="artist-tile">${artistAvatar(artist, 'artist-tile-avatar')}<div class="artist-tile-meta"><a class="artist-tile-name" href="${songLink(own[0].id)}">${esc(artist.name)}</a><span class="subline">${esc(artist.genre)} · ${own.length} song${own.length === 1 ? '' : 's'}</span></div>${followButton(artist, 'card-follow artist-tile-follow', false)}</article>`;
}

function artistsRow() {
  return `<section class="song-section" aria-labelledby="row-artists"><div class="section-heading"><div><h2 class="section-title" id="row-artists">Artists to know</h2><span class="section-note">Follow artists to shape your recommendations</span></div>${rowControls('artists', 'artists', false)}</div>
    <div class="artist-row" data-row-track="artists">${artists.map(artistTile).join('')}</div></section>`;
}

function discoverResults() {
  const filtering = ui.search.trim() || ui.genre !== 'all' || ui.followedOnly;
  if (filtering) {
    const filtered = filteredSongs();
    if (!filtered.length) return emptyState('No songs found', 'Try a different song, artist, or filter.', '<button class="button secondary" data-action="clear-filters">Clear search and filters</button>');
    return `<section class="song-section"><div class="section-heading"><div><h2 class="section-title">${filtered.length} result${filtered.length === 1 ? '' : 's'}</h2></div><button class="text-button see-all" data-action="clear-filters">Clear</button></div><div class="song-grid">${filtered.map(songCard).join('')}</div></section>`;
  }
  const expanded = discoverSections().find(section => section.id === ui.expandedSection);
  if (expanded) {
    return `<section class="song-section"><button class="text-button back-link" data-action="see-all" data-section="">${icon('back')} All sections</button><div class="section-heading"><div><h2 class="section-title">${expanded.title}</h2><span class="section-note">${esc(expanded.note)}</span></div></div><div class="song-grid">${expanded.songs.map(songCard).join('')}</div></section>`;
  }
  const [forYou, ...rest] = discoverSections();
  return featureBanner() + songRow(forYou) + artistsRow() + rest.map(songRow).join('');
}

// Decorative, interactive soundwave: each cluster of bars is one song, shaped by its recent views.
// Hover a cluster to see the song; click it to open the song.
function soundwave() {
  const now = currentRoundStart();
  const groups = songs.map((song, index) => {
    const history = getHistory(song.id, now, 3).slice(-5);
    const max = Math.max(...history.map(point => point.views), 1);
    const bars = history.map((point, bar) => {
      const height = 22 + (point.views / max) * 58 * (0.55 + (song.growth / 100));
      return `<rect class="wave-bar" style="--i:${index * 5 + bar}" x="${index * 34 + bar * 6}" y="${100 - Math.min(96, height)}" width="4" height="${Math.min(96, height)}" rx="2"/>`;
    }).join('');
    return `<g class="wave-group" data-action="open-song" data-song="${song.id}" data-label="${esc(song.title)} · ${esc(artistFor(song).name)} · ${number(song.dailyViews)} views/day" tabindex="-1">${bars}<rect class="wave-hit" x="${index * 34 - 3}" y="0" width="34" height="100" fill="transparent"/></g>`;
  }).join('');
  return `<figure class="soundwave" aria-label="Songs in the catalogue, shown as a soundwave"><svg viewBox="-4 0 ${songs.length * 34} 100" preserveAspectRatio="none" role="img" aria-hidden="true">${groups}</svg><figcaption class="wave-label" aria-live="polite">Hover the wave to find a song</figcaption></figure>`;
}

function photoCredit(id) {
  const credit = PHOTO_CREDITS[id];
  return credit ? `<p class="photo-credit">Photo by <a href="${credit.profile}" target="_blank" rel="noopener noreferrer">${esc(credit.photographer)}</a> on <a href="${credit.source}" target="_blank" rel="noopener noreferrer">Unsplash</a></p>` : '';
}

function featureBanner() {
  const song = songs.find(isLive);
  if (!song || !FEATURE_IMAGE) return '';
  const artist = artistFor(song);
  return `<section class="feature-banner" style="--feature-image:url('${FEATURE_IMAGE}')"><div class="feature-copy"><span class="feature-tag"><span class="live-dot" aria-hidden="true"></span>Live test contest</span><h2>${esc(song.title)}</h2><p>${esc(artist.name)} · ${esc(artist.genre)} · ${number(song.dailyViews)} daily views</p><a class="button primary" href="${songLink(song.id)}">Make a prediction ${icon('arrow')}</a></div>${photoCredit('__feature')}</section>`;
}

function genreChips(genres) {
  return `<div class="genre-chips" role="group" aria-label="Filter by genre">${['all', ...genres].map(genre => `<button class="chip ${ui.genre === genre ? 'selected' : ''}" data-action="genre-chip" data-genre="${esc(genre)}" aria-pressed="${ui.genre === genre}">${genre === 'all' ? 'All genres' : esc(genre)}</button>`).join('')}</div>`;
}

function renderDiscover() {
  const filterCount = Number(ui.genre !== 'all') + Number(ui.followedOnly);
  const genres = [...new Set(artists.map(artist => artist.genre))].sort();
  const today = songs.filter(song => !isLive(song)).map(song => getRoundSummary(state, song.id, currentRoundStart(), '24h'));
  const pooled = today.reduce((sum, item) => sum + item.totalEnteredCents, 0);
  const predictors = today.reduce((sum, item) => sum + item.peopleCount, 0);
  return `<main class="page-shell"><section class="hero"><div class="hero-copy"><p class="eyebrow">${icon('compass')}Discover</p><h1 class="page-title hero-title">Spot the next big moment.</h1><p class="page-description">Choose a song. Predict its video views. Support the artist.</p></div>${soundwave()}</section>
    <dl class="hero-stats" aria-label="Sample activity this round"><div><span class="stat-icon">${icon('wallet')}</span><dt><span class="live-dot" aria-hidden="true"></span>In this round's pools</dt><dd>${money(pooled)}</dd></div><div><span class="stat-icon">${icon('user')}</span><dt>Predictions this round</dt><dd>${number(predictors)}</dd></div><div><span class="stat-icon">${icon('music')}</span><dt>Songs open</dt><dd>${songs.length}</dd></div></dl><p class="hero-note">Sample statistics</p>
    <div class="discover-tools"><label class="search-field">${icon('search')}<span class="sr-only">Search songs or artists</span><input id="song-search" type="search" placeholder="Search a song or artist" value="${esc(ui.search)}" autocomplete="off" /></label><button class="button filter-toggle ${ui.filtersOpen || filterCount ? 'is-active' : ''}" data-action="filters" aria-expanded="${ui.filtersOpen}" aria-controls="filter-panel">${icon('filter')}Filters${filterCount ? `<span class="filter-count">${filterCount}</span>` : ''}</button></div>
    ${genreChips(genres)}
    <div id="filter-panel" class="filter-panel ${ui.filtersOpen ? 'visible' : ''}"><label class="field-label">Genre<select class="select-input" id="genre-filter"><option value="all">All genres</option>${genres.map(genre => `<option ${genre === ui.genre ? 'selected' : ''}>${esc(genre)}</option>`).join('')}</select></label><label class="checkbox-label"><input id="followed-filter" type="checkbox" ${ui.followedOnly ? 'checked' : ''}/> Only artists I follow</label><button class="text-button" data-action="clear-filters">Reset filters</button></div>
    <div class="discover-results">${discoverResults()}</div><p class="fine-print page-footnote">Browse sample songs, view counts, and contest results. Sign up with your email whenever you’re ready. Artists are fictional; photos are stock images from <a href="https://unsplash.com/?utm_source=music_onchain_demo&amp;utm_medium=referral" target="_blank" rel="noopener noreferrer">Unsplash</a> used for this demo.</p></main>`;
}

function renderSupport(context) {
  const { song, roundStart, horizon } = context;
  const artist = artistFor(song);
  const paymentState=payments.getState(),liveSong=song.id==='last-bus-home';
  const liveRound=liveSong?paymentState.catalog?.rounds?.find(r=>r.id===context.liveRoundId):null;
  if(liveSong&&!liveRound) {
    const message=paymentState.catalogError||(!paymentState.catalog?'Checking live test rounds…':paymentState.catalog.ready?'No matching test round is scheduled. Choose the current round or refresh.':paymentState.catalog.message||'Live test rounds are unavailable.');
    return `<main class="page-shell support-page"><a class="breadcrumb" href="#discover">${icon('back')} All songs</a><h1 class="page-title">${esc(song.title)}</h1><section class="panel live-round-empty"><h2 class="panel-title">Test contest</h2><p role="status">${esc(message)}</p><button class="button secondary" data-action="payments-refresh">Refresh</button><button class="button secondary" data-action="current-round">Open current round</button></section></main>`;
  }
  const summaries=Object.fromEntries(HORIZONS.map(item=>{
    const p=liveRound?paymentState.pools[liveRound.id+':'+item.id]:null;
    return [item.id,liveSong?(p??{average:null,averageGuess:null,mode:null,modeSpots:null,spotCount:null,peopleCount:null,totalDeposits:null}):getRoundSummary(state,song.id,roundStart,item.id)];
  }));
  const summary=summaries[horizon],livePool=liveRound?paymentState.pools[liveRound.id+':'+horizon]:null;
  const snapshot=liveRound?paymentState.roundSnapshots[liveRound.id]:null;
  const now=liveSong?payments.serverNow():Date.now();
  const open=liveSong?Boolean(livePool?.open&&now>=roundStart&&now<liveRound.deadline):now>=roundStart&&now<roundStart+HOUR;
  const currentAccount=account.getState();
  const canPay=Boolean(liveRound&&open&&snapshot?.chainAvailable!==false&&currentAccount.authenticated&&currentAccount.approvalStatus==='approved'&&!paymentState.busy);
  const entryMessage=liveRound?(paymentState.catalogError||snapshot?.syncStatus==='unavailable'?'Live details cannot refresh right now. Your saved purchases are unchanged.':!livePool?'Checking this round…':open?'Test entries use your demo account balance. Network fees are additional.':now<roundStart?'This test round has not opened yet.':'Entries are closed for this test round.'):PURCHASES_PAUSED;
  const selected = horizonFor(horizon);
  return `<main class="page-shell support-page">
    <a class="breadcrumb" href="#discover">${icon('back')} Discover</a>
    <div class="song-page-heading"><div class="song-heading-meta">${artistAvatar(artist, 'song-avatar')}<div><p class="eyebrow">${liveRound?'Test contest · Simulated music statistics':'TikTok · BGM video views <span class="sample-inline">/ Sample data</span>'}</p><h1 class="page-title">${esc(song.title)}</h1><p class="song-artist">${esc(artist.name)} <span class="genre-tag">${esc(artist.genre)}</span></p></div></div><button class="button secondary small" data-action="rules">${icon('info')} How rewards work</button></div>
    ${liveRound?`<div class="live-round-toolbar"><label class="field-label" for="live-round-select">Test round<select class="select-input" id="live-round-select">${paymentState.catalog.rounds.map(r=>`<option value="${esc(r.id)}" ${r.id===liveRound.id?'selected':''}>${dateTime(r.start)} CT · ${r.entryStatus??'test round'}</option>`).join('')}</select></label><p class="live-freshness" role="status">${esc(freshness(snapshot,paymentState.catalogError))}</p></div>`:''}
    <div class="support-overview">
      <section class="panel"><div class="artist-summary">${artistAvatar(artist, 'artist-avatar')}<div><span class="field-label">You’re supporting</span><h2 class="artist-heading">${esc(artist.name)}</h2></div></div>${followButton(artist, 'button secondary full-width')}<details class="artist-details"><summary>About the artist ${icon('down')}</summary><p class="artist-bio">${esc(artist.bio)}</p><p class="fine-print">The artist receives 2% of profit won in their contests.</p></details>${photoCredit(artist.id)}</section>
      <section class="panel"><div class="round-meta"><span class="field-label">Hourly round</span><strong>${dateTime(roundStart)} CT</strong></div><div class="round-status">${icon('clock')}<span>${open?'Entries close in':Date.now()<roundStart?'Entries open '+dateTime(roundStart)+' CT':'Entries closed'}</span>${open ? `<strong class="countdown" data-countdown="${roundStart + HOUR}"></strong>` : ''}</div><p class="fine-print">${Date.now()<roundStart?'Closes':open?'Closes':'Closed'} ${dateTime(roundStart + HOUR)} CT</p><div class="stat-grid"><div class="side-stat"><strong>${number(summary.peopleCount)}</strong><span>people</span></div><div class="side-stat"><strong>${number(summary.spotCount)}</strong><span>${money(SPOT_PRICE_CENTS)} spots</span></div></div><div class="round-total"><span>Total entered · ${selected.label}</span><strong>${liveSong?(summary.totalDeposits==null?'—':nativeDollars(summary.totalDeposits)):money(summary.totalEnteredCents)}</strong></div><p class="fine-print">Each hourly round has its own three prediction windows.</p></section>
      <section class="panel popular-panel"><h2 class="panel-title">Most popular guesses</h2><p class="fine-print">Most common value, counted by spots</p><table class="popular-table"><thead><tr><th scope="col">Window</th><th scope="col">Views</th><th scope="col">Spots</th></tr></thead><tbody>${HORIZONS.map(item => `<tr class="popular-row ${item.id === horizon ? 'selected' : ''}"><td><button class="text-button" data-action="select-horizon" data-horizon="${item.id}">${item.label}</button></td><td>${summaries[item.id].mode==null?'—':number(BigInt(summaries[item.id].mode))}</td><td>${liveCount(summaries[item.id].modeSpots)}</td></tr>`).join('')}</tbody></table><p class="fine-print">The chart shows the average. Tied popular guesses use the lower value.</p></section>
    </div>
    <div class="support-layout"><div class="support-main">
      <section class="panel chart-panel"><div class="panel-heading"><div><h2 class="panel-title">Follow the momentum</h2><p class="muted chart-subtitle">${liveSong?'Simulated music views · actual crowd predictions':'Views in the 24 hours ending at each point'}</p></div><div class="segmented-control chart-controls" aria-label="Historical chart range">${[3, 7, 30].map(days => `<button data-action="history-days" data-days="${days}" class="${ui.historyDays === days ? 'active' : ''}" aria-pressed="${ui.historyDays === days}">${days}D</button>`).join('')}</div></div>
      <div class="chart-wrap">${renderChart({ history: getHistory(song.id, roundStart, ui.historyDays), roundStart, summaries, selectedHorizon: horizon, horizons: HORIZONS, live: liveSong })}</div>
      <div class="chart-legend"><span><i class="legend-line solid"></i>Simulated past views</span><span><i class="legend-line dashed"></i>${liveSong?'Actual crowd average':'Sample crowd average'}</span><span class="chart-note">Select a future point to predict</span></div></section>
      <section class="panel prediction-panel"><div class="panel-heading"><h2 class="panel-title">Make your prediction</h2><span class="badge ${open ? 'blue' : 'orange'}">${open ? (liveRound ? 'Entries open' : 'Purchases paused') : 'Entries closed'}</span></div>
      <div class="horizon-tabs" role="group" aria-label="Choose a prediction window">${HORIZONS.map(item => `<button class="${item.id === horizon ? 'selected' : ''}" data-action="select-horizon" data-horizon="${item.id}" aria-pressed="${item.id === horizon}"><span class="horizon-title">${item.label}</span><span class="horizon-detail">${item.id === '24h' ? 'First day' : item.id === '48h' ? 'Second day' : 'Seventh day'}</span></button>`).join('')}</div>
      <div class="window-box"><span class="window-label">Count new views during this period</span><span class="window-value">${measurement(roundStart, horizon)}</span></div>
      <form id="prediction-form" class="prediction-form" novalidate><div class="prediction-grid"><label class="guess-field field-label" for="prediction-guess">Your guess, in views<input id="prediction-guess" name="guess" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. ${summary.mode==null?'30000':number(summary.mode)}" value="${esc(ui.guess)}" aria-describedby="guess-hint form-error" ${!open ? 'disabled' : ''} /></label>
      <fieldset class="amount-fieldset"><legend class="field-label">Choose your entry</legend><div class="amount-options">${ENTRY_PRICES_CENTS.map(amount => `<button type="button" class="amount-option ${ui.amount === amount ? 'selected' : ''}" data-action="amount" data-amount="${amount}" aria-pressed="${ui.amount === amount}" ${!open ? 'disabled' : ''}><span class="amount-top">${money(amount)}</span><span class="amount-bottom">${paymentOption(amount).spots===1?'1 spot':paymentOption(amount).spots+' identical spots'}</span>${amount === BUNDLE_PRICE_CENTS ? `<span class="bonus-label">Up to ${BUNDLE_MULTIPLIER.toFixed(2)}× reward</span>` : '<span class="standard-label">Standard entry</span>'}</button>`).join('')}</div></fieldset></div>
      <p id="guess-hint" class="fine-print">${ui.amount === BUNDLE_PRICE_CENTS ? 'Your one guess is entered ten times. A winning spot gets the 5% bonus only when its matched losing spot belongs to a different account. Spots paired within the same account use the standard reward.' : paymentOption(ui.amount).id==='four'?'Four separate $5 entries. Same guess. No bonus. All four are purchased together.':`One ${money(SPOT_PRICE_CENTS)} spot enters your guess in this round.`}</p>
      <p class="error-message" id="form-error" role="alert">${esc(ui.formError)}</p>
      <p class="purchase-paused" id="purchase-pause-notice">${esc(entryMessage)}</p><div class="purchase-footer">${open ? `<button class="button primary" type="submit" ${canPay?'':'disabled'} aria-describedby="purchase-pause-notice">${paymentState.busy?'Preparing purchase…':liveRound?'Review purchase':'Purchases paused'}</button>` : `<button class="button secondary" type="button" data-action="current-round">Open current round</button>`}</div></form></section>
    </div></div></main>`;
}

function statusLabel(purchase) {
  const status = getPurchaseStatus(purchase);
  return `<span class="badge ${status === 'completed' ? 'green' : status === 'awaiting' ? 'orange' : 'blue'}"><span class="status-dot"></span>${status === 'completed' ? 'Completed' : status === 'awaiting' ? 'Awaiting result' : 'Pending'}</span>`;
}

function purchaseRow(purchase) {
  const song = songs.find(item => item.id === purchase.songId);
  const artist = artistFor(song);
  const result = purchase.result;
  const profit = result ? result.returnedCents - purchase.costCents : null;
  const outcome = profit === null ? 'pending' : profit > 0 ? 'won' : profit < 0 ? 'lost' : 'even';
  return `<tr class="purchase-row outcome-${outcome}" data-action="purchase-detail" data-id="${purchase.id}" tabindex="0" role="button" aria-label="View ${esc(song.title)} purchase, ${statusLabelText(purchase)}">
    <td><div class="purchase-song">
      ${artistAvatar(artist, 'purchase-song-avatar')}
      <div class="purchase-song-meta"><strong>${esc(song.title)}</strong><span class="subline">${esc(artist.name)}</span></div>
    </div></td>
    <td class="purchase-period-cell">${horizonFor(purchase.horizon).label}
      <span class="subline purchase-period">${measurement(purchase.roundStart, purchase.horizon)}</span>
      <span class="subline">Entered ${dateTime(purchase.purchasedAt)}</span>
    </td>
    <td>${number(purchase.guess)}<span class="subline">views</span></td>
    <td>${money(purchase.costCents)}<span class="subline">${purchase.spots} ${purchase.spots === 1 ? 'spot' : 'spots'}${purchase.multiplier > 1 ? ' · Up to 1.05×' : ''}</span></td>
    <td>${result ? `<span class="rank-label">#${result.mainRank}</span>${result.timeRank ? `<span class="subline">Time #${result.timeRank} of ${result.timeRankTotal}</span>` : `<span class="subline">${result.neutral ? 'Middle spot' : 'Main rank'}</span>`}` : '<span class="muted">—</span>'}</td>
    <td>${statusLabel(purchase)}${profit !== null ? `<span class="outcome-pill outcome-${outcome}">${outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'Even'}</span>` : ''}</td>
    <td class="profit-cell">${profit !== null ? `<strong class="${profitClass(profit)}">${signedMoney(profit)}</strong><span class="subline">${money(result.returnedCents)} returned</span>` : '<span class="muted">Awaiting result</span>'}</td>
    <td class="row-arrow">${icon('arrow')}</td>
  </tr>`;
}

function statusLabelText(purchase) {
  return { pending: 'pending', awaiting: 'awaiting official result', completed: 'completed sample result' }[getPurchaseStatus(purchase)];
}

const PURCHASE_SORTS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['profit-high', 'Highest net profit'],
  ['profit-low', 'Lowest net profit'], ['amount-high', 'Largest entry'], ['song', 'Song A–Z'],
];
const FOLLOW_SORTS = [['recent', 'Recently followed'], ['az', 'Artist A–Z'], ['za', 'Artist Z–A'], ['songs', 'Most songs']];

function sortControl(id, options, value) {
  return `<label class="sort-control">${icon('sort')}<span class="sr-only">Sort by</span><select class="select-input" id="${id}">${options.map(([key, label]) => `<option value="${key}" ${key === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
}

function sortedPurchases(list) {
  const profit = purchase => (purchase.result ? purchase.result.returnedCents - purchase.costCents : null);
  const title = purchase => songs.find(item => item.id === purchase.songId)?.title ?? '';
  const byProfit = direction => (a, b) => {
    const x = profit(a), y = profit(b);
    if (x === null || y === null) return (x === null) - (y === null); // awaiting results last
    return direction * (y - x);
  };
  const compare = {
    newest: (a, b) => b.purchasedAt - a.purchasedAt,
    oldest: (a, b) => a.purchasedAt - b.purchasedAt,
    'profit-high': byProfit(1),
    'profit-low': byProfit(-1),
    'amount-high': (a, b) => b.costCents - a.costCents || b.purchasedAt - a.purchasedAt,
    song: (a, b) => title(a).localeCompare(title(b)) || b.purchasedAt - a.purchasedAt,
  }[ui.purchaseSort] ?? ((a, b) => b.purchasedAt - a.purchasedAt);
  return [...list].sort(compare);
}

function sortedFollowed(list) {
  const songCount = artist => songs.filter(song => song.artistId === artist.id).length;
  if (ui.followSort === 'az') return [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (ui.followSort === 'za') return [...list].sort((a, b) => b.name.localeCompare(a.name));
  if (ui.followSort === 'songs') return [...list].sort((a, b) => songCount(b) - songCount(a) || a.name.localeCompare(b.name));
  return [...list].sort((a, b) => state.follows.indexOf(b.id) - state.follows.indexOf(a.id));
}

const outcomeOf = purchase => {
  if (!purchase.result) return 'pending';
  const profit = purchase.result.returnedCents - purchase.costCents;
  return profit > 0 ? 'won' : profit < 0 ? 'lost' : 'even';
};

function visiblePurchases() {
  const list = sortedPurchases(state.purchases);
  return ui.outcomeFilter === 'all' ? list : list.filter(purchase => outcomeOf(purchase) === ui.outcomeFilter);
}

function outcomeFilters() {
  const options = [['all', 'All'], ['won', 'Won'], ['lost', 'Lost'], ['even', 'Even'], ['pending', 'Awaiting']];
  const count = key => key === 'all' ? state.purchases.length : state.purchases.filter(purchase => outcomeOf(purchase) === key).length;
  return `<div class="outcome-filters" role="group" aria-label="Show purchases by result">${options.map(([key, label]) => `<button class="chip outcome-chip chip-${key} ${ui.outcomeFilter === key ? 'selected' : ''}" data-action="outcome-filter" data-outcome="${key}" aria-pressed="${ui.outcomeFilter === key}">${label}<span>${count(key)}</span></button>`).join('')}</div>`;
}

function renderPurchases(context) {
  const portfolio = getPortfolio(state);
  const followed = artists.filter(artist => state.follows.includes(artist.id));
  const pending = state.purchases.filter(purchase => purchase.status === 'pending').length;
  let content;
  if (context.tab === 'subscribed') {
    content = followed.length ? `<div class="followed-grid">${sortedFollowed(followed).map(artist => `<article class="followed-card"><div class="artist-summary">${artistAvatar(artist, 'artist-avatar')}<div><h2 class="artist-heading">${esc(artist.name)}</h2><span class="genre-tag">${esc(artist.genre)}</span></div></div><p class="artist-bio">${esc(artist.bio)}</p><div class="followed-songs">${songs.filter(song => song.artistId === artist.id).map(song => `<a href="${songLink(song.id)}">${esc(song.title)} ${icon('arrow')}</a>`).join('')}</div>${followButton(artist, 'button secondary small')}</article>`).join('')}</div>` : emptyState('Find your people', 'Follow an artist to keep their songs here.', '<a class="button primary" href="#discover">Discover artists</a>');
  } else {
    content = state.purchases.length ? `<div class="table-container"><table class="purchase-table"><thead><tr><th scope="col">Song / artist</th><th scope="col">Window / purchased</th><th scope="col">Your guess</th><th scope="col">Entry</th><th scope="col">Rank</th><th scope="col">Status</th><th scope="col">Net profit</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${visiblePurchases().map(purchaseRow).join('') || `<tr><td colspan="8" class="table-empty">No ${ui.outcomeFilter === 'pending' ? 'purchases awaiting a result' : `${ui.outcomeFilter} purchases`} yet.</td></tr>`}</tbody></table></div>` : emptyState('No sample purchases', 'Browse songs and charts while purchases are unavailable in this preview.', '<a class="button primary" href="#discover">Explore songs</a>');
  }
  const tabs = `<div class="purchase-toolbar"><div class="tabs" aria-label="Purchase views"><a href="#purchases?tab=subscribed" class="${context.tab === 'subscribed' ? 'active' : ''}">Subscribed <span>${followed.length}</span></a><a href="#purchases" class="${context.tab === 'all' ? 'active' : ''}">All Purchases <span>${state.purchases.length}</span></a></div><div class="toolbar-end">${context.tab === 'all' ? `<span class="section-note">${pending} pending · ${state.purchases.length - pending} completed</span>${state.purchases.length > 1 ? sortControl('purchase-sort', PURCHASE_SORTS, ui.purchaseSort) : ''}` : `<span class="section-note">Following is free</span>${followed.length > 1 ? sortControl('follow-sort', FOLLOW_SORTS, ui.followSort) : ''}`}</div></div>`;
  const samples = state.purchases.length ? `<section class="sample-section"><div class="sample-heading"><div><h2 class="section-title">Sample history <span class="sample-tag">Demo data</span></h2><p class="section-note sample-history-notice">These are sample records stored in this browser. They are not purchases made by your signed-in account and do not affect your account balance.</p></div>
      <div class="sample-summary"><span><strong>${portfolio.supportedArtists}</strong> artists supported</span><span><strong class="${profitClass(portfolio.netProfitCents)}">${signedMoney(portfolio.netProfitCents)}</strong> net</span></div></div>
      ${outcomeFilters()}${content}</section>` : content;
  const body = context.tab === 'subscribed' ? content : `${accountPurchaseMarkup(account.getState(),payments.getState())}${samples}`;
  return `<main class="page-shell purchases-page"><div class="page-header"><div><p class="eyebrow">${icon('receipt')}My Purchases</p><h1 class="page-title hero-title">Your predictions</h1><p class="page-description">Keep track of the artists you support and how your predictions perform.</p></div><span class="sample-data-label">Account &amp; sample records</span></div>
    ${tabs}<div class="tab-panel">${body}</div></main>`;
}

let lastHtml = '';
function tickCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach(element => { element.textContent = countdown(Number(element.dataset.countdown)); });
}

function render(background = false) {
  const context = route();
  if (context.page === 'support') {
    ui.lastSong = context.song.id;
    const key = `${context.song.id}:${context.roundStart}:${context.horizon}`;
    if (key !== ui.lastContext) { ui.guess = ''; ui.formError = ''; ui.lastContext = key; }
  }
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.page = context.page;
  const html = renderHeader(context.page) + (context.page === 'support' ? renderSupport(context) : context.page === 'purchases' ? renderPurchases(context) : renderDiscover());
  // Background refreshes (render(true)) run every second; replacing identical markup made the page
  // flicker, closed open menus and moved the scroll position, so they skip the swap when nothing changed.
  if (!background || html !== lastHtml) app.innerHTML = html;
  lastHtml = html;
  tickCountdowns();
  const chosenRound=context.page==='support'&&context.song.id==='last-bus-home'?context.liveRoundId:payments.currentRound()?.id??null;
  payments.selectRound(chosenRound);
  app.inert = ui.settingsOpen || Boolean(ui.modal);
  document.title = `${context.page === 'support' ? context.song.title : context.page === 'purchases' ? 'My Purchases' : 'Discover'} · ampramp`;
}

function detailRows(rows) {
  return `<dl class="detail-list">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function modalContent() {
  const modal = ui.modal;
  if(modal.type==='live-entry-detail'){const ps=payments.getState();return entryModal(ps.entryGroups.find(g=>g.id===modal.id),{orders:ps.orders,snapshot:ps.entriesSnapshot});}
  if(modal.type==='live-confirm'||modal.type==='live-detail'){const ps=payments.getState();return orderModal(ps.orders.find(o=>o.id===modal.id),{rounds:ps.catalog?.rounds,error:ps.error,busy:ps.busy,confirm:modal.type==='live-confirm'});}
  if (modal.type === 'confirm') return { title: 'Purchases paused', body: `<p>${PURCHASES_PAUSED}</p>`, footer: '<button class="button primary" data-action="close-modal">Got it</button>' };
  if (modal.type === 'purchase') {
    const purchase = state.purchases.find(item => item.id === modal.id);
    const song = songs.find(item => item.id === purchase.songId);
    const result = purchase.result;
    const rankRows = result ? [['Actual views', number(result.actual)], ['Main rank', `#${result.mainRank}${result.neutral ? ' · Neutral middle spot' : ''}`], ...(result.timeRank ? [['Time rank within losing group', `#${result.timeRank} of ${result.timeRankTotal}`]] : [])] : [];
    const financialRows = result ? [
      ['Purchase cost', money(purchase.costCents)],
      ['Base winnings', `+${money(result.baseWinningsCents)}`],
      ['Bundle bonus', `+${money(result.bonusCents)}`],
      ['Transferred to winning spots', `−${money(result.lossCents)}`],
      ['Artist fee · 2% of profit won', `−${money(result.artistFeeCents)}`],
      [`App fee${result.mainRank <= 2 ? ' · Waived for this rank' : ' · 2% of profit won'}`, `−${money(result.appFeeCents)}`],
    ] : [['Purchase cost', money(purchase.costCents)], ['Result expected after', `${dateTime(purchase.roundStart + horizonFor(purchase.horizon).endHours * HOUR)} CT`]];
    return { title: 'Sample prediction', body: `<div class="confirmation-song"><strong>${esc(song.title)}</strong>${statusLabel(purchase)}</div>${detailRows([
      ['Purchased', `${dateTime(purchase.purchasedAt, true)} CT`], ['Hourly round', `${dateTime(purchase.roundStart)} CT`],
      ['View-count period', measurement(purchase.roundStart, purchase.horizon)],
      ['Your guess', `${number(purchase.guess)} views`], ['Entries', `${purchase.spots} ${purchase.spots === 1 ? 'spot' : 'identical spots'} · ${purchase.multiplier.toFixed(2)}× ${purchase.multiplier > 1 ? 'maximum multiplier; bonus requires a different matched account' : 'multiplier'}`], ...rankRows,
    ])}<div class="breakdown-section"><h3>Purchase breakdown</h3>${detailRows(financialRows)}${result ? `<div class="breakdown-total"><span>Money returned</span><strong>${money(result.returnedCents)}</strong></div><div class="breakdown-total profit-total"><span>Net profit</span><strong class="${profitClass(result.returnedCents - purchase.costCents)}">${signedMoney(result.returnedCents - purchase.costCents)}</strong></div>${result.appContributionCents ? `<div class="info-box">The app’s bonus reserve supplied ${money(result.appContributionCents)} of this reward, keeping each losing spot’s loss within its ${money(SPOT_PRICE_CENTS)} deposit.</div>` : ''}<p class="fine-print">${result.bonusCents ? 'This bonus example assumes matched losing spots from different accounts. ' : ''}Illustrative completed result. Currency amounts are rounded to the nearest cent.</p>` : '<div class="info-box">This sample entry is saved in this browser. It is separate from your signed-in account and has no payment.</div>'}</div>`, footer: `<a class="button secondary" href="${songLink(purchase.songId, purchase.horizon, purchase.roundStart)}" data-action="close-modal">View this round ${icon('arrow')}</a><button class="button primary" data-action="close-modal">Done</button>` };
  }
  if (modal.type === 'reset') return { title: 'Reset the local demo?', body: '<p>This restores five completed sample purchases, two followed artists, and the light theme. Local demo purchases and follows will be cleared. Your account and balance will stay as they are.</p>', footer: '<button class="button secondary" data-action="close-modal">Keep exploring</button><button class="button danger" data-action="confirm-reset">Reset demo</button>' };
  return { title: 'How rewards work', wide: true, body: `<div class="rules-grid"><section class="rule-card"><span class="rule-number">01</span><h3>Predict a 24-hour window</h3><p>Each hourly round opens for one hour. Predict new BGM video views during the first, second, or seventh day after it starts.</p></section><section class="rule-card"><span class="rule-number">02</span><h3>Your ${money(SPOT_PRICE_CENTS)} spot gets a rank</h3><p>Rank each spot by distance from the actual count. Equally accurate guesses share dense main ranks: 1, 1, 2, 3. Earlier entries win ties at the winning/losing boundary.</p></section><section class="rule-card"><span class="rule-number">03</span><h3>Winnings come from transfers</h3><p>The strongest winner is matched with the least accurate loser, continuing inward. The curve sets the transfer percentage. An odd middle spot keeps its deposit. Losing time ranks are chronological display information; they do not change the funding pairs.</p></section><section class="rule-card"><span class="rule-number">04</span><h3>Support the musician</h3><p>Each winning spot pays 2% of gross winnings, including its bonus, to the artist and 2% to the app. Shared main ranks 1 and 2 pay the artist fee only. Losing and neutral spots pay no extra fee.</p></section></div>
      <div class="curve-heading"><h3>Your 100-position reference curve</h3><div class="chart-legend"><span><i class="legend-line solid"></i>Combined</span><span class="curve-linear">Linear</span><span class="curve-exponential">Exponential</span></div></div>${renderRewardCurve()}<p class="rules-formula">x = min(100, 1 + (main rank − 1) × 100 / total spots)<br/>Linear weight = 0.40 − 0.20 × (x − 1) / 99<br/>Transfer % = 0.90 × (linear weight × (101 − x) + (1 − linear weight) × 100 × 0.5<sup>x − 1</sup>)</p>
      <div class="info-box"><strong>The $20 option</strong><p>One payment creates four separate $5 entries with the same guess, a 1.00 multiplier, and no bonus. Either all four entries are purchased together or none are created. Network fees are additional.</p></div><div class="info-box"><strong>The ${money(BUNDLE_PRICE_CENTS)} option</strong><p>One guess creates ${BUNDLE_SPOTS} identical ${money(SPOT_PRICE_CENTS)} spots, with a maximum 1.05 reward multiplier. The 5% bonus applies only when the winning spot and its matched losing spot belong to different accounts. Pairs within the same account receive no bundle bonus. Matched losing spots fund the extra transfer up to their ${money(SPOT_PRICE_CENTS)} deposits. The app’s separate bonus reserve funds any excess and reserves up to $2.50 per bundle.</p></div><p class="fine-print">The chart shows the 90%-scaled reference curve; first place transfers 90% before bonuses and fees. A 50-spot pool samples positions 1, 3, 5…; a 25-spot pool uses 1, 5, 9…. Larger pools use fractional positions. Completed results are illustrative sample records. Purchases are not available in this preview.</p>`, footer: '<button class="button primary" data-action="close-modal">Got it</button>' };
}

let modalTrigger = null;
function openModal(modal) {
  returnToSettings = ui.settingsOpen;
  modalTrigger = ui.settingsOpen ? document.querySelector('[data-action="settings"]') : document.activeElement;
  closeSettings(false);
  ui.modal = modal;

  renderModal();
}

function renderModal() {
  if (!ui.modal) {
    modalRoot.innerHTML = '';
    app.inert = ui.settingsOpen;
    if (!ui.settingsOpen) document.body.style.overflow = '';
    return;
  }
  const content = modalContent();
  app.inert = true;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${content.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-header"><h2 id="modal-title">${content.title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${content.body}</div><div class="modal-footer">${content.footer}</div></section></div>`;
  document.body.style.overflow = 'hidden';
  modalRoot.querySelector('.modal').focus();
}

function closeModal() {
  if (!ui.modal) return;
  ui.modal = null;
  renderModal();
  if (returnToSettings) {
    returnToSettings = false;
    openSettings();
  } else if (modalTrigger?.isConnected) modalTrigger.focus({ preventScroll: true });
}

function toast(message) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.innerHTML = `<span class="toast-icon">${icon('check')}</span><span>${esc(message)}</span>`;
  document.querySelector('#toast-root').append(element);
  setTimeout(() => element.remove(), 4500);
}

function refreshDiscoverResults() {
  const results = document.querySelector('.discover-results');
  if (results) results.innerHTML = discoverResults();
}

document.addEventListener('input', event => {
  if (event.target.id === 'song-search') { ui.search = event.target.value; refreshDiscoverResults(); }
  if (event.target.id === 'prediction-guess') { ui.guess = event.target.value; ui.formError = ''; document.querySelector('#form-error').textContent = ''; }
});

document.addEventListener('change', event => {
  if(event.target.id==='live-round-select'){location.hash=`#support?song=last-bus-home&roundId=${encodeURIComponent(event.target.value)}&horizon=${route().horizon}`;return;}
  if (event.target.id === 'purchase-sort') { ui.purchaseSort = event.target.value; keepScroll(render); document.getElementById('purchase-sort')?.focus({ preventScroll: true }); return; }
  if (event.target.id === 'follow-sort') { ui.followSort = event.target.value; keepScroll(render); document.getElementById('follow-sort')?.focus({ preventScroll: true }); return; }
  if (event.target.id === 'genre-filter') { ui.genre = event.target.value; refreshDiscoverResults(); }
  if (event.target.id === 'followed-filter') { ui.followedOnly = event.target.checked; refreshDiscoverResults(); }
  const count = Number(ui.genre !== 'all') + Number(ui.followedOnly);
  const filter = document.querySelector('.filter-toggle');
  if (filter) filter.innerHTML = `${icon('filter')}Filters${count ? `<span class="filter-count">${count}</span>` : ''}`;
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'prediction-form') return;
  event.preventDefault();
  const context=route(),ps=payments.getState();
  const round=context.song.id==='last-bus-home'&&ps.catalog?.ready?ps.catalog.rounds.find(r=>r.start===context.roundStart):null;
  if(!round){ui.formError=PURCHASES_PAUSED;document.querySelector('#form-error').textContent=ui.formError;return;}
  if(!/^\d{1,78}$/.test(ui.guess)||BigInt(ui.guess)>(1n<<256n)-1n){ui.formError='Enter a nonnegative whole-number prediction.';document.querySelector('#form-error').textContent=ui.formError;return;}
  void payments.prepare({roundId:round.id,horizon:context.horizon,guess:BigInt(ui.guess).toString(),optionId:paymentOption(ui.amount).id}).then(order=>{if(order)openModal({type:'live-confirm',id:order.id});}).catch(error=>{ui.formError=error.message;render();});
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const context = route();
  if (action === 'open-song') {
    location.hash = songLink(target.dataset.song);
  } else if (action === 'follow') {
    const followed = toggleFollow(state, target.dataset.artist);
    render();
    toast(followed ? 'Artist added to Subscribed.' : 'Artist unfollowed.');
  } else if (action === 'settings') {
    openSettings(target);
  } else if (action === 'close-settings' || (action === 'settings-backdrop' && event.target === target)) {
    closeSettings();
  } else if (action === 'account-login') {
    const current = account.getState();
    if (!current.configured || !current.ready) {
      openSettings(target);
    } else {
      closeSettings(false);
      if (ui.modal) { returnToSettings = false; closeModal(); }
      returnFromLogin = true;
      void account.signIn();
    }
  } else if (action === 'account-logout') {
    void account.signOut();
  } else if (action === 'account-refresh') {
    void account.refreshBalance();
    void account.refreshApproval();
  } else if (action === 'account-retry-approval') {
    void account.retryApproval();
  } else if (action === 'account-retry-setup') {
    void account.retrySetup();
  } else if (action === 'account-reload') {
    location.reload();
  } else if (action === 'theme') {
    setTheme(state, state.theme === 'light' ? 'dark' : 'light'); render();
    const appearance = settingsRoot.querySelector('#settings-appearance');
    if (appearance) {
      appearance.innerHTML = appearanceContent();
      appearance.querySelector('[data-action="theme"]').focus({ preventScroll: true });
    }
  } else if (action === 'reset') {
    openModal({ type: 'reset' });
  } else if (action === 'confirm-reset') {
    state = createInitialState(); saveState(state); ui.guess = ''; ui.formError = ''; ui.search = ''; ui.genre = 'all'; ui.followedOnly = false; ui.filtersOpen = false; closeModal(); render(); toast('Sample data and appearance reset.');
  } else if (action === 'outcome-filter') {
    ui.outcomeFilter = target.dataset.outcome; keepScroll(render);
  } else if (action === 'row-scroll') {
    const track = document.querySelector(`[data-row-track="${target.dataset.row}"]`);
    track?.scrollBy({ left: Number(target.dataset.dir) * track.clientWidth * 0.85, behavior: 'smooth' });
  } else if (action === 'see-all') {
    ui.expandedSection = target.dataset.section || ''; render();
    if (ui.expandedSection) document.querySelector('.discover-results')?.scrollIntoView({ block: 'start' });
  } else if (action === 'genre-chip') {
    ui.genre = target.dataset.genre; ui.expandedSection = ''; keepScroll(render);
  } else if (action === 'filters') {
    ui.filtersOpen = !ui.filtersOpen; render();
  } else if (action === 'clear-filters') {
    ui.search = ''; ui.genre = 'all'; ui.followedOnly = false; render();
  } else if (action === 'history-days') {
    ui.historyDays = Number(target.dataset.days); render();
  } else if (action === 'select-horizon') {
    location.hash = songLink(context.song.id, target.dataset.horizon, context.roundStart);
  } else if (action === 'amount') {
    ui.amount = Number(target.dataset.amount); render();
  } else if (action === 'current-round') {
    location.hash = songLink(context.song.id, context.horizon);
  } else if (action === 'rules') {
    openModal({ type: 'rules' });
  } else if (action === 'purchase-detail') {
    openModal({ type: 'purchase', id: target.dataset.id });
  } else if(action==='payments-refresh'){
    void payments.refresh();
  } else if(action==='entries-next'){
    void payments.nextEntries();
  } else if(action==='entries-previous'){
    void payments.previousEntries();
  } else if(action==='entry-detail'){
    openModal({type:'live-entry-detail',id:target.dataset.id});
  } else if(action==='live-detail'){
    const order=payments.getState().orders.find(o=>o.id===target.dataset.id);
    openModal({type:order?.status==='awaiting_signature'?'live-confirm':'live-detail',id:target.dataset.id});
  } else if(action==='payment-confirm'){
    const id=target.dataset.id,user=account.getState().userId;closeSettings(false);closeModal();
    void payments.confirm(id).then(()=>{if(account.getState().userId===user)openModal({type:'live-detail',id});}).catch(()=>{if(account.getState().userId===user)openModal({type:'live-confirm',id});});
  } else if(action==='payment-cancel'){
    void payments.cancel(target.dataset.id).then(()=>closeModal()).catch(()=>renderModal());
  } else if (action === 'close-modal') {
    closeModal();
  } else if (action === 'backdrop' && event.target === target) {
    closeModal();
  } else if (action === 'confirm-buy' && ui.modal?.type === 'confirm') {
    ui.modal.error = PURCHASES_PAUSED;
    renderModal();
  }
});

document.addEventListener('pointerover', event => {
  const group = event.target.closest?.('.wave-group');
  const label = document.querySelector('.wave-label');
  if (group && label) label.textContent = group.dataset.label;
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (ui.modal) closeModal();
    else if (ui.settingsOpen) closeSettings();
  }
  if ((ui.modal || ui.settingsOpen) && event.key === 'Tab') {
    const root = ui.modal ? modalRoot : settingsRoot;
    const dialog = root.querySelector('[role="dialog"]');
    const controls = [...root.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if (!dialog.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
    else if (event.shiftKey && document.activeElement.matches('.account-card')) { event.preventDefault(); first?.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const target = event.target.closest('.chart-point, .purchase-row');
  if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

function viewKey(context = route()) { return context.page === 'support' ? `support:${context.song.id}` : context.page; }
function keepScroll(fn) { const y = window.scrollY; fn(); window.scrollTo({ top: y }); }
window.addEventListener('hashchange', () => {
  closeSettings(false); closeModal();
  const next = viewKey();
  if (next === ui.lastView) { keepScroll(render); return; }
  ui.lastView = next;
  const swap = () => { render(); window.scrollTo({ top: 0 }); };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(swap);
  else swap();
});
window.addEventListener('storage', event => {
  if (event.key === 'music-prediction-demo-v1') { state = loadState(); render(); if (ui.modal?.type === 'confirm') renderModal(); }
});

let lastHour = currentRoundStart();
setInterval(() => {
  tickCountdowns();
  if (currentRoundStart() !== lastHour) { lastHour = currentRoundStart(); render(); }
}, 1000);

ui.lastView = viewKey();
render();
loadArtistPhotos(() => keepScroll(render));
account.subscribe(refreshAccountUI);
document.addEventListener('visibilitychange',()=>{account.onVisibilityChange();if(!document.hidden)void payments.refresh();});

let paymentRefreshTimer=null;
payments.subscribe(()=>{
  const focused=document.activeElement;
  const field=focused?.id;
  const action=focused?.dataset?.action;
  const selection=field==='prediction-guess'?[focused.selectionStart,focused.selectionEnd]:null;
  const before=lastHtml;
  render(true);
  if(ui.modal?.type?.startsWith('live-'))renderModal();
  if(lastHtml===before)return;
  if(field){const next=document.getElementById(field);next?.focus({preventScroll:true});if(selection&&next?.type!=='number')next?.setSelectionRange(...selection);}
  else if(action&&!account.getState().dialogOpen)(ui.modal?modalRoot:ui.settingsOpen?settingsRoot:app).querySelector(`[data-action="${action}"]:not([disabled])`)?.focus({preventScroll:true});
});
payments.start();
paymentRefreshTimer=setInterval(()=>{if(!document.hidden)void payments.poll();},1000);
paymentRefreshTimer.unref?.();
