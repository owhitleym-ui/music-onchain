import { HOUR, HORIZONS, artists, songs, currentRoundStart, getHistory } from './data.js';
import { createInitialState, loadState, saveState, toggleFollow, setTheme, buyPrediction, getRoundSummary, getPortfolio, getPurchaseStatus } from './store.js';
import { icon } from './icons.js';
import { renderChart, renderRewardCurve } from './chart.js';

let state = loadState();
const ui = {
  search: '', genre: 'all', followedOnly: false, filtersOpen: false,
  historyDays: 3, amount: 1000, guess: '', formError: '',
  lastSong: 'animals', lastContext: '', modal: null, profileOpen: false,
};
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const artistFor = song => artists.find(artist => artist.id === song.artistId);
const horizonFor = id => HORIZONS.find(horizon => horizon.id === id) || HORIZONS[0];
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const number = (value, decimals = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(value);
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
  const seconds = Math.max(0, Math.floor((end - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function route() {
  const [page = 'discover', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const songId = params.get('song') || ui.lastSong;
  const song = songs.find(item => item.id === songId) || songs[0];
  const roundParam = Number(params.get('round'));
  const roundStart = params.has('round') && Number.isSafeInteger(roundParam) && roundParam % HOUR === 0 && roundParam <= currentRoundStart() ? roundParam : currentRoundStart();
  return {
    page: ['discover', 'support', 'purchases'].includes(page) ? page : 'discover',
    song, roundStart, horizon: horizonFor(params.get('horizon')).id,
    tab: params.get('tab') === 'subscribed' ? 'subscribed' : 'all',
  };
}

function songLink(songId, horizon = '24h', roundStart = currentRoundStart()) {
  return `#support?song=${encodeURIComponent(songId)}&round=${roundStart}&horizon=${horizon}`;
}

function followButton(artist, className = 'button secondary small', showText = true) {
  const followed = state.follows.includes(artist.id);
  return `<button type="button" class="${className} ${followed ? 'is-followed' : ''}" data-action="follow" data-artist="${artist.id}" aria-pressed="${followed}" aria-label="${followed ? 'Unfollow' : 'Follow'} ${esc(artist.name)}" title="${followed ? 'Following' : 'Follow'} ${esc(artist.name)}">${icon(followed ? 'check' : 'heart')}${showText ? `<span>${followed ? 'Following' : 'Follow artist'}</span>` : ''}</button>`;
}

function renderHeader(page) {
  return `<header class="site-header"><div class="header-inner">
    <a class="brand" href="#discover" aria-label="Music predictions home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>Music predictions</a>
    <nav class="main-nav" aria-label="Main navigation">
      <a href="#discover" class="${page === 'discover' ? 'active' : ''}" ${page === 'discover' ? 'aria-current="page"' : ''}>Discover</a>
      <a href="${songLink(ui.lastSong)}" class="${page === 'support' ? 'active' : ''}" ${page === 'support' ? 'aria-current="page"' : ''}>Support Artist</a>
      <a href="#purchases" class="${page === 'purchases' ? 'active' : ''}" ${page === 'purchases' ? 'aria-current="page"' : ''}>My Purchases</a>
    </nav>
    <div class="header-actions"><span class="demo-badge"><span></span>Local demo</span>
      <button class="icon-button" data-action="theme" aria-label="Switch to ${state.theme === 'light' ? 'dark' : 'light'} mode" title="Switch theme">${icon(state.theme === 'light' ? 'moon' : 'sun')}</button>
      <div class="profile-anchor"><button class="balance-button" data-action="profile" aria-expanded="${ui.profileOpen}" aria-label="Demo wallet, balance ${money(state.balanceCents)}">${icon('wallet')}<span>${money(state.balanceCents)}</span>${icon('down')}</button>
      ${ui.profileOpen ? `<div class="profile-menu"><div class="profile-caption">Demo wallet · test USDC</div><div class="profile-balance">${money(state.balanceCents)}</div><button class="menu-item" data-action="reset">${icon('reset')} Reset demo</button></div>` : ''}</div>
    </div>
  </div></header>`;
}

function cover(song, small = false) {
  const artist = artistFor(song);
  return `<div class="song-cover ${small ? 'small-cover' : ''}" style="--cover-color:${artist.color}" aria-hidden="true"><span class="cover-mark">${esc(artist.initials)}</span><span class="cover-lines"><i></i><i></i><i></i><i></i><i></i></span>${small ? '' : `<span class="cover-caption">${esc(song.title)}</span>`}</div>`;
}

function songCard(song, index) {
  const artist = artistFor(song);
  const summary = getRoundSummary(state, song.id, currentRoundStart(), '24h');
  return `<article class="song-card" data-action="open-song" data-song="${song.id}">
    <div class="cover-container"><a href="${songLink(song.id)}" aria-label="Predict views for ${esc(song.title)}">${cover(song)}</a><span class="card-number">${String(index + 1).padStart(2, '0')}</span>${followButton(artist, 'card-follow', false)}</div>
    <div class="song-card-body"><a class="song-title" href="${songLink(song.id)}">${esc(song.title)}</a><div class="song-artist">${esc(artist.name)}</div>
      <div class="song-stats"><div><span class="stat-value">${number(song.dailyViews)}</span><span class="stat-label">daily video views</span></div><span class="growth">${icon('trend')}${song.growth}%</span></div>
      <div class="card-bottom"><span class="genre-tag">${esc(artist.genre)}</span><a class="card-open" href="${songLink(song.id)}" aria-label="Open ${esc(song.title)} contest">${number(summary.spotCount)} spots ${icon('arrow')}</a></div>
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

function discoverResults() {
  const filtered = filteredSongs();
  if (!filtered.length) return emptyState('No songs found', 'Try a different song, artist, or filter.', '<button class="button secondary" data-action="clear-filters">Clear search and filters</button>');
  return ['popular', 'rising'].map(category => {
    const group = filtered.filter(song => song.category === category);
    if (!group.length) return '';
    return `<section class="song-section"><div class="section-heading"><h2 class="section-title">${category === 'popular' ? 'Popular BGMs' : 'Fast-rising Artists'}</h2><span class="section-note">${category === 'popular' ? 'Most watched in our sample collection' : 'Songs gaining momentum'}</span></div><div class="song-grid">${group.map(songCard).join('')}</div></section>`;
  }).join('');
}

function renderDiscover() {
  const filterCount = Number(ui.genre !== 'all') + Number(ui.followedOnly);
  const genres = [...new Set(artists.map(artist => artist.genre))].sort();
  return `<main class="page-shell"><div class="page-header"><div><p class="eyebrow">A little music intuition.</p><h1 class="page-title">Spot the next big moment.</h1><p class="page-description">Choose a song. Predict its video views. Support the artist.</p></div><span class="sample-data-label">Sample songs &amp; statistics</span></div>
    <div class="discover-tools"><label class="search-field">${icon('search')}<span class="sr-only">Search songs or artists</span><input id="song-search" type="search" placeholder="Search a song or artist" value="${esc(ui.search)}" autocomplete="off" /></label><button class="button secondary filter-toggle" data-action="filters" aria-expanded="${ui.filtersOpen}" aria-controls="filter-panel">${icon('filter')}Filters${filterCount ? `<span class="filter-count">${filterCount}</span>` : ''}</button></div>
    <div id="filter-panel" class="filter-panel ${ui.filtersOpen ? 'visible' : ''}"><label class="field-label">Genre<select class="select-input" id="genre-filter"><option value="all">All genres</option>${genres.map(genre => `<option ${genre === ui.genre ? 'selected' : ''}>${esc(genre)}</option>`).join('')}</select></label><label class="checkbox-label"><input id="followed-filter" type="checkbox" ${ui.followedOnly ? 'checked' : ''}/> Only artists I follow</label><button class="text-button" data-action="clear-filters">Reset filters</button></div>
    <div class="discover-results">${discoverResults()}</div><p class="fine-print page-footnote">Explore with demo funds. All view counts, crowds, and results shown here are sample data.</p></main>`;
}

function renderSupport(context) {
  const { song, roundStart, horizon } = context;
  const artist = artistFor(song);
  const summaries = Object.fromEntries(HORIZONS.map(item => [item.id, getRoundSummary(state, song.id, roundStart, item.id)]));
  const summary = summaries[horizon];
  const open = Date.now() >= roundStart && Date.now() < roundStart + HOUR;
  const selected = horizonFor(horizon);
  return `<main class="page-shell support-page">
    <a class="breadcrumb" href="#discover">${icon('back')} All songs</a>
    <div class="song-page-heading"><div class="song-heading-meta"><div class="song-avatar" style="--cover-color:${artist.color}">${esc(artist.initials)}</div><div><p class="eyebrow">TikTok · BGM video views <span class="sample-inline">/ Sample data</span></p><h1 class="page-title">${esc(song.title)}</h1><p class="song-artist">${esc(artist.name)} <span class="genre-tag">${esc(artist.genre)}</span></p></div></div><button class="button secondary small" data-action="rules">${icon('info')} How rewards work</button></div>
    <div class="support-layout"><div class="support-main">
      <section class="panel chart-panel"><div class="panel-heading"><div><h2 class="panel-title">Follow the momentum</h2><p class="muted chart-subtitle">Views in the 24 hours ending at each point</p></div><div class="segmented-control chart-controls" aria-label="Historical chart range">${[3, 7, 30].map(days => `<button data-action="history-days" data-days="${days}" class="${ui.historyDays === days ? 'active' : ''}" aria-pressed="${ui.historyDays === days}">${days}D</button>`).join('')}</div></div>
      <div class="chart-wrap">${renderChart({ history: getHistory(song.id, roundStart, ui.historyDays), roundStart, summaries, selectedHorizon: horizon, horizons: HORIZONS })}</div>
      <div class="chart-legend"><span><i class="legend-line solid"></i>Past views</span><span><i class="legend-line dashed"></i>Crowd average</span><span class="chart-note">Select a future point to predict</span></div></section>
      <section class="panel prediction-panel"><div class="panel-heading"><h2 class="panel-title">Make your prediction</h2><span class="badge ${open ? 'green' : 'orange'}">${open ? 'Accepting entries' : 'Entries closed'}</span></div>
      <div class="horizon-tabs" role="group" aria-label="Choose a prediction window">${HORIZONS.map(item => `<button class="${item.id === horizon ? 'selected' : ''}" data-action="select-horizon" data-horizon="${item.id}" aria-pressed="${item.id === horizon}"><span class="horizon-title">${item.label}</span><span class="horizon-detail">${item.id === '24h' ? 'First day' : item.id === '48h' ? 'Second day' : 'Seventh day'}</span></button>`).join('')}</div>
      <div class="window-box"><span class="window-label">Count new views during this period</span><span class="window-value">${measurement(roundStart, horizon)}</span></div>
      <form id="prediction-form" class="prediction-form" novalidate><div class="prediction-grid"><label class="guess-field field-label" for="prediction-guess">Your guess, in views<input id="prediction-guess" name="guess" type="text" inputmode="numeric" autocomplete="off" placeholder="e.g. ${number(summary.mode)}" value="${esc(ui.guess)}" aria-describedby="guess-hint form-error" ${!open ? 'disabled' : ''} /></label>
      <fieldset class="amount-fieldset"><legend class="field-label">Choose your entry</legend><div class="amount-options">${[1000, 10000].map(amount => `<button type="button" class="amount-option ${ui.amount === amount ? 'selected' : ''}" data-action="amount" data-amount="${amount}" aria-pressed="${ui.amount === amount}" ${!open ? 'disabled' : ''}><span class="amount-top">${money(amount)}</span><span class="amount-bottom">${amount === 1000 ? '1 spot' : '10 identical spots'}</span>${amount === 10000 ? '<span class="bonus-label">1.05× reward weight</span>' : '<span class="standard-label">Standard entry</span>'}</button>`).join('')}</div></fieldset></div>
      <p id="guess-hint" class="fine-print">${ui.amount === 10000 ? 'Your one guess is entered ten times. Each spot receives a 5% reward bonus when it wins.' : 'One $10 spot enters your guess in this round.'}</p>
      <p class="error-message" id="form-error" role="alert">${esc(ui.formError)}</p>
      <div class="purchase-footer"><span class="cost-caption">${icon('wallet')} ${money(state.balanceCents)} demo balance</span>${open ? `<button class="button primary" type="submit">Review prediction ${icon('arrow')}</button>` : `<button class="button primary" type="button" data-action="current-round">Open current round ${icon('arrow')}</button>`}</div></form></section>
    </div><aside class="support-sidebar">
      <section class="panel"><div class="artist-summary"><div class="artist-avatar" style="--cover-color:${artist.color}">${esc(artist.initials)}</div><div><span class="field-label">You’re supporting</span><h2 class="artist-heading">${esc(artist.name)}</h2></div></div>${followButton(artist, 'button secondary full-width')}<details class="artist-details"><summary>About the artist ${icon('down')}</summary><p class="artist-bio">${esc(artist.bio)}</p><p class="fine-print">The artist receives 2% of profit won in their contests.</p></details></section>
      <section class="panel"><div class="round-meta"><span class="field-label">Hourly round</span><strong>${dateTime(roundStart)} CT</strong></div><div class="round-status">${icon('clock')}<span>${open ? 'Entries close in' : 'Entries closed'}</span>${open ? `<strong class="countdown" data-countdown="${roundStart + HOUR}">${countdown(roundStart + HOUR)}</strong>` : ''}</div><p class="fine-print">${open ? 'Closes' : 'Closed'} ${dateTime(roundStart + HOUR)} CT</p><div class="stat-grid"><div class="side-stat"><strong>${number(summary.peopleCount)}</strong><span>people</span></div><div class="side-stat"><strong>${number(summary.spotCount)}</strong><span>$10 spots</span></div></div><div class="round-total"><span>Total entered · ${selected.label}</span><strong>${money(summary.totalEnteredCents)}</strong></div><p class="fine-print">Each hourly round has its own three prediction windows.</p></section>
      <section class="panel popular-panel"><h2 class="panel-title">Most popular guesses</h2><p class="fine-print">Most common value, counted by spots</p><table class="popular-table"><thead><tr><th scope="col">Window</th><th scope="col">Views</th><th scope="col">Spots</th></tr></thead><tbody>${HORIZONS.map(item => `<tr class="popular-row ${item.id === horizon ? 'selected' : ''}"><td><button class="text-button" data-action="select-horizon" data-horizon="${item.id}">${item.label}</button></td><td>${number(summaries[item.id].mode)}</td><td>${summaries[item.id].modeSpots}</td></tr>`).join('')}</tbody></table><p class="fine-print">The chart shows the average. Tied popular guesses use the lower value.</p></section>
    </aside></div></main>`;
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
  return `<tr class="purchase-row" data-action="purchase-detail" data-id="${purchase.id}" tabindex="0" role="button" aria-label="View ${esc(song.title)} purchase, ${statusLabelText(purchase)}">
    <td><div class="purchase-song">
      <span class="purchase-song-avatar" style="--cover-color:${artist.color}">${esc(artist.initials)}</span>
      <div class="purchase-song-meta"><strong>${esc(song.title)}</strong><span class="subline">${esc(artist.name)}</span></div>
    </div></td>
    <td class="purchase-period-cell">${horizonFor(purchase.horizon).label}
      <span class="subline purchase-period">${measurement(purchase.roundStart, purchase.horizon)}</span>
      <span class="subline">Entered ${dateTime(purchase.purchasedAt)}</span>
    </td>
    <td>${number(purchase.guess)}<span class="subline">views</span></td>
    <td>${money(purchase.costCents)}<span class="subline">${purchase.spots} ${purchase.spots === 1 ? 'spot' : 'spots'}${purchase.multiplier > 1 ? ' · 1.05×' : ''}</span></td>
    <td>${result ? `<span class="rank-label">#${result.mainRank}</span>${result.timeRank ? `<span class="subline">Time #${result.timeRank} of ${result.timeRankTotal}</span>` : `<span class="subline">${result.neutral ? 'Middle spot' : 'Main rank'}</span>`}` : '<span class="muted">—</span>'}</td>
    <td>${statusLabel(purchase)}</td>
    <td class="profit-cell">${profit !== null ? `<strong class="${profitClass(profit)}">${signedMoney(profit)}</strong><span class="subline">${money(result.returnedCents)} returned</span>` : '<span class="muted">Awaiting result</span>'}</td>
    <td class="row-arrow">${icon('arrow')}</td>
  </tr>`;
}

function statusLabelText(purchase) {
  return { pending: 'pending', awaiting: 'awaiting official result', completed: 'completed sample result' }[getPurchaseStatus(purchase)];
}

function renderPurchases(context) {
  const portfolio = getPortfolio(state);
  const followed = artists.filter(artist => state.follows.includes(artist.id));
  const pending = state.purchases.filter(purchase => purchase.status === 'pending').length;
  let content;
  if (context.tab === 'subscribed') {
    content = followed.length ? `<div class="followed-grid">${followed.map(artist => `<article class="followed-card"><div class="artist-summary"><span class="artist-avatar" style="--cover-color:${artist.color}">${esc(artist.initials)}</span><div><h2 class="artist-heading">${esc(artist.name)}</h2><span class="genre-tag">${esc(artist.genre)}</span></div></div><p class="artist-bio">${esc(artist.bio)}</p><div class="followed-songs">${songs.filter(song => song.artistId === artist.id).map(song => `<a href="${songLink(song.id)}">${esc(song.title)} ${icon('arrow')}</a>`).join('')}</div>${followButton(artist, 'button secondary small')}</article>`).join('')}</div>` : emptyState('Find your people', 'Follow an artist to keep their songs here.', '<a class="button primary" href="#discover">Discover artists</a>');
  } else {
    content = state.purchases.length ? `<div class="table-container"><table class="purchase-table"><thead><tr><th scope="col">Song / artist</th><th scope="col">Window / purchased</th><th scope="col">Your guess</th><th scope="col">Entry</th><th scope="col">Rank</th><th scope="col">Status</th><th scope="col">Net profit</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${state.purchases.map(purchaseRow).join('')}</tbody></table></div>` : emptyState('Your first prediction starts here', 'Choose a song and make a guess to see your entries here.', '<a class="button primary" href="#discover">Explore songs</a>');
  }
  return `<main class="page-shell"><div class="page-header"><div><p class="eyebrow">Your music intuition, on record.</p><h1 class="page-title">My Purchases</h1><p class="page-description">Keep track of the artists you support and how your predictions perform.</p></div><span class="sample-data-label">Sample results · New entries stay pending</span></div>
    <div class="portfolio-stats"><section class="portfolio-stat"><span class="field-label">Artists supported</span><strong class="portfolio-value">${portfolio.supportedArtists}<span>artists</span></strong><p class="fine-print">Across all your prediction purchases</p></section><section class="portfolio-stat"><span class="field-label">Net profit</span><strong class="portfolio-value ${profitClass(portfolio.netProfitCents)}">${signedMoney(portfolio.netProfitCents)}</strong><p class="fine-print">Money returned minus completed purchase costs</p></section></div>
    <div class="purchase-toolbar"><div class="tabs" aria-label="Purchase views"><a href="#purchases?tab=subscribed" class="${context.tab === 'subscribed' ? 'active' : ''}">Subscribed <span>${followed.length}</span></a><a href="#purchases" class="${context.tab === 'all' ? 'active' : ''}">All Purchases <span>${state.purchases.length}</span></a></div>${context.tab === 'all' ? `<span class="section-note">${pending} pending · ${state.purchases.length - pending} completed</span>` : '<span class="section-note">Following is free</span>'}</div>${content}
    <p class="fine-print page-footnote">Completed examples illustrate results and fees. New demo purchases remain pending until a future results connection is added.</p></main>`;
}

function render() {
  const context = route();
  if (context.page === 'support') {
    ui.lastSong = context.song.id;
    const key = `${context.song.id}:${context.roundStart}:${context.horizon}`;
    if (key !== ui.lastContext) { ui.guess = ''; ui.formError = ''; ui.lastContext = key; }
  }
  document.documentElement.dataset.theme = state.theme;
  app.innerHTML = renderHeader(context.page) + (context.page === 'support' ? renderSupport(context) : context.page === 'purchases' ? renderPurchases(context) : renderDiscover());
  document.title = `${context.page === 'support' ? context.song.title : context.page === 'purchases' ? 'My Purchases' : 'Discover'} · Music predictions`;
}

function detailRows(rows) {
  return `<dl class="detail-list">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function modalContent() {
  const modal = ui.modal;
  if (modal.type === 'confirm') {
    const song = songs.find(item => item.id === modal.request.songId);
    const artist = artistFor(song);
    const request = modal.request;
    return {
      title: 'Review your prediction',
      body: `<div class="confirmation-song"><span class="song-avatar" style="--cover-color:${artist.color}">${esc(artist.initials)}</span><div><strong>${esc(song.title)}</strong><span class="subline">${esc(artist.name)}</span></div><span class="badge blue">Demo purchase</span></div>${detailRows([
        ['Hourly round', `${dateTime(request.roundStart)} CT`],
        ['Prediction window', `${horizonFor(request.horizon).label} · ${measurement(request.roundStart, request.horizon)}`],
        ['Your guess', `<strong>${number(request.guess)} views</strong>`],
        ['$10 spots', request.costCents === 10000 ? '10 spots · same guess on every spot' : '1 spot'],
        ['Reward multiplier', request.costCents === 10000 ? '1.05× · 5% extra winning reward' : '1.00×'],
      ])}<div class="info-box">Artist fee: 2% of profit won. App fee: 2% of profit won, waived for main ranks 1 and 2.</div><div class="confirmation-total"><span>Total from demo balance</span><strong>${money(request.costCents)}</strong></div><p class="fine-print">New purchases will appear as pending. Your guess is fixed after confirmation.</p>${modal.error ? `<p class="error-message" role="alert">${esc(modal.error)}</p>` : ''}`,
      footer: `<button class="button secondary" data-action="close-modal">Go back</button><button class="button primary" data-action="confirm-buy">Confirm ${money(request.costCents)} prediction</button>`,
    };
  }
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
    return { title: 'Your prediction', body: `<div class="confirmation-song"><strong>${esc(song.title)}</strong>${statusLabel(purchase)}</div>${detailRows([
      ['Purchased', `${dateTime(purchase.purchasedAt, true)} CT`], ['Hourly round', `${dateTime(purchase.roundStart)} CT`],
      ['View-count period', measurement(purchase.roundStart, purchase.horizon)],
      ['Your guess', `${number(purchase.guess)} views`], ['Entries', `${purchase.spots} ${purchase.spots === 1 ? 'spot' : 'identical spots'} · ${purchase.multiplier.toFixed(2)}× multiplier`], ...rankRows,
    ])}<div class="breakdown-section"><h3>Purchase breakdown</h3>${detailRows(financialRows)}${result ? `<div class="breakdown-total"><span>Money returned</span><strong>${money(result.returnedCents)}</strong></div><div class="breakdown-total profit-total"><span>Net profit</span><strong class="${profitClass(result.returnedCents - purchase.costCents)}">${signedMoney(result.returnedCents - purchase.costCents)}</strong></div>${result.appContributionCents ? `<div class="info-box">The app’s bonus reserve supplied ${money(result.appContributionCents)} of this reward, keeping each losing spot’s loss within its $10 deposit.</div>` : ''}<p class="fine-print">Illustrative completed result. Currency amounts are rounded to the nearest cent.</p>` : '<div class="info-box">Your entry is saved in this browser. This local demo shows sample completed results while new predictions await a future results connection.</div>'}</div>`, footer: `<a class="button secondary" href="${songLink(purchase.songId, purchase.horizon, purchase.roundStart)}" data-action="close-modal">View this round ${icon('arrow')}</a><button class="button primary" data-action="close-modal">Done</button>` };
  }
  if (modal.type === 'reset') return { title: 'Reset the local demo?', body: '<p>This restores the $1,000 demo balance, five completed examples, two followed artists, and the light theme. Your new demo purchases and follows will be cleared.</p>', footer: '<button class="button secondary" data-action="close-modal">Keep exploring</button><button class="button danger" data-action="confirm-reset">Reset demo</button>' };
  return { title: 'How rewards work', wide: true, body: `<div class="rules-grid"><section class="rule-card"><span class="rule-number">01</span><h3>Predict a 24-hour window</h3><p>Each hourly round opens for one hour. Predict new BGM video views during the first, second, or seventh day after it starts.</p></section><section class="rule-card"><span class="rule-number">02</span><h3>Your $10 spot gets a rank</h3><p>The closest guesses rank highest. Identical guesses share a main rank. Within the losing half, earlier entries receive a higher time rank.</p></section><section class="rule-card"><span class="rule-number">03</span><h3>Winnings come from transfers</h3><p>The upper half receives transfers from the lower half. The curve sets the transfer percentage. For an odd number of spots, the middle spot keeps its deposit.</p></section><section class="rule-card"><span class="rule-number">04</span><h3>Support the musician</h3><p>Winning profit pays 2% to the artist and 2% to the app. Main ranks 1 and 2 pay the artist fee only. Losing spots pay no extra fee.</p></section></div>
      <div class="curve-heading"><h3>Your 100-rank curve</h3><div class="chart-legend"><span><i class="legend-line solid"></i>Combined</span><span class="curve-linear">Linear</span><span class="curve-exponential">Exponential</span></div></div>${renderRewardCurve()}<p class="rules-formula">Linear weight = 0.40 − 0.20 × (rank − 1) / 99<br/>Transfer % = linear weight × (101 − rank) + (1 − linear weight) × 100 × 0.5<sup>rank − 1</sup></p>
      <div class="info-box"><strong>The $100 option</strong><p>One guess creates ten identical $10 spots, each with a 1.05 reward multiplier. Matched losing spots fund the extra transfer up to their $10 deposits. The app’s separate bonus reserve funds any excess.</p></div><p class="fine-print">This chart illustrates the saved 100-rank formula. Completed results are sample records. Full settlement, including boundary ties, will be connected with the backend.</p>`, footer: '<button class="button primary" data-action="close-modal">Got it</button>' };
}

let modalTrigger = null;
function openModal(modal) {
  modalTrigger = document.activeElement;
  ui.modal = modal;
  ui.profileOpen = false;
  renderModal();
}

function renderModal() {
  if (!ui.modal) {
    modalRoot.innerHTML = '';
    app.inert = false;
    document.body.style.overflow = '';
    return;
  }
  const content = modalContent();
  app.inert = true;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal ${content.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-header"><h2 id="modal-title">${content.title}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${content.body}</div><div class="modal-footer">${content.footer}</div></section></div>`;
  document.body.style.overflow = 'hidden';
  modalRoot.querySelector('.modal').focus();
}

function closeModal() {
  ui.modal = null;
  renderModal();
  if (modalTrigger?.isConnected) modalTrigger.focus();
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
  if (event.target.id === 'genre-filter') { ui.genre = event.target.value; refreshDiscoverResults(); }
  if (event.target.id === 'followed-filter') { ui.followedOnly = event.target.checked; refreshDiscoverResults(); }
  const count = Number(ui.genre !== 'all') + Number(ui.followedOnly);
  const filter = document.querySelector('.filter-toggle');
  if (filter) filter.innerHTML = `${icon('filter')}Filters${count ? `<span class="filter-count">${count}</span>` : ''}`;
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'prediction-form') return;
  event.preventDefault();
  const value = ui.guess.trim();
  const guess = Number(value.replace(/,/g, ''));
  const validFormat = /^\d+$/.test(value) || /^\d{1,3}(,\d{3})+$/.test(value);
  if (!validFormat || !Number.isSafeInteger(guess)) {
    ui.formError = 'Enter a whole number of views, starting at zero.';
    document.querySelector('#form-error').textContent = ui.formError;
    document.querySelector('#prediction-guess').focus();
    return;
  }
  const context = route();
  if (state.balanceCents < ui.amount) {
    ui.formError = 'Your demo balance is too low. Choose $10 or reset the demo wallet.';
    document.querySelector('#form-error').textContent = ui.formError;
    return;
  }
  if (Date.now() >= context.roundStart + HOUR) { render(); return; }
  openModal({ type: 'confirm', request: { songId: context.song.id, roundStart: context.roundStart, horizon: context.horizon, guess, costCents: ui.amount } });
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    if (ui.profileOpen && !event.target.closest('.profile-anchor')) { ui.profileOpen = false; render(); }
    return;
  }
  const action = target.dataset.action;
  const context = route();
  if (action === 'open-song') {
    location.hash = songLink(target.dataset.song);
  } else if (action === 'follow') {
    const followed = toggleFollow(state, target.dataset.artist);
    render();
    toast(followed ? 'Artist added to Subscribed.' : 'Artist unfollowed.');
  } else if (action === 'theme') {
    setTheme(state, state.theme === 'light' ? 'dark' : 'light'); render();
  } else if (action === 'profile') {
    ui.profileOpen = !ui.profileOpen; render();
  } else if (action === 'reset') {
    openModal({ type: 'reset' });
  } else if (action === 'confirm-reset') {
    state = createInitialState(); saveState(state); ui.guess = ''; ui.formError = ''; ui.profileOpen = false; ui.search = ''; ui.genre = 'all'; ui.followedOnly = false; ui.filtersOpen = false; closeModal(); render(); toast('Demo reset. Your balance is $1,000.');
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
  } else if (action === 'close-modal') {
    closeModal();
  } else if (action === 'backdrop' && event.target === target) {
    closeModal();
  } else if (action === 'confirm-buy' && ui.modal?.type === 'confirm') {
    target.disabled = true;
    try {
      const purchase = buyPrediction(state, ui.modal.request);
      closeModal(); ui.guess = ''; ui.formError = ''; render();
      toast(`${money(purchase.costCents)} prediction saved · ${purchase.spots} ${purchase.spots === 1 ? 'spot' : 'identical spots'}.`);
    } catch (error) {
      ui.modal.error = error.message; renderModal();
    }
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (ui.modal) closeModal();
    else if (ui.profileOpen) { ui.profileOpen = false; render(); }
  }
  if (ui.modal && event.key === 'Tab') {
    const controls = [...modalRoot.querySelectorAll('button:not([disabled]), a[href], input, [tabindex="0"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRoot.querySelector('.modal'))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const target = event.target.closest('.chart-point, .purchase-row');
  if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});

window.addEventListener('hashchange', () => { closeModal(); ui.profileOpen = false; render(); window.scrollTo({ top: 0 }); });
window.addEventListener('storage', event => {
  if (event.key === 'music-prediction-demo-v1') { state = loadState(); render(); if (ui.modal?.type === 'confirm') renderModal(); }
});

let lastHour = currentRoundStart();
setInterval(() => {
  document.querySelectorAll('[data-countdown]').forEach(element => { element.textContent = countdown(Number(element.dataset.countdown)); });
  if (currentRoundStart() !== lastHour) { lastHour = currentRoundStart(); render(); }
}, 1000);

render();
