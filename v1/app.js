// NestMatch demo: two partners swipe on the same filtered pool of homes.
// Both like it → match. Matches go into a head-to-head Final Round until one home is left.

const STORE_KEY = 'nestmatch-demo-v1';
const byId = Object.fromEntries(LISTINGS.map((l) => [l.id, l]));
const PRICE_MIN = 100000;
const PRICE_MAX = 1000000;

const defaultFilters = () => ({
  minPrice: 200000, maxPrice: 800000, beds: 0, baths: 0, types: [], hoods: [], musts: [],
});
const defaultState = () => ({
  setupStep: 0, // 0 names, 1 filters, 2 done
  partners: { a: 'Taylor', b: 'Nick' },
  active: 'a',
  filters: defaultFilters(),
  swipes: { a: {}, b: {} },
  lastSwipe: null,
  view: 'swipe',
  final: null,
  winner: null,
});

let state = load();
let draftFilters = null; // filters being edited in the sheet
let animating = false;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) return { ...defaultState(), ...s };
  } catch (e) { /* fall through */ }
  return defaultState();
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const other = (p) => (p === 'a' ? 'b' : 'a');
const nm = (p) => esc(state.partners[p]);
const money = (n) => '$' + n.toLocaleString('en-US');
const shortMoney = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1000)}k`);
const specs = (l) => `${l.beds} bd · ${l.baths} ba · ${l.sqft.toLocaleString('en-US')} sqft`;
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function passes(l, f = state.filters) {
  return l.price >= f.minPrice && l.price <= f.maxPrice
    && l.beds >= f.beds && l.baths >= f.baths
    && (!f.types.length || f.types.includes(l.type))
    && (!f.hoods.length || f.hoods.includes(l.hood))
    && f.musts.every((m) => l.features.includes(m));
}

function deckFor(p) {
  const mine = state.swipes[p];
  const theirs = state.swipes[other(p)];
  // Homes the partner already liked come first so matches show up sooner (the swiper doesn't see this).
  return LISTINGS
    .filter((l) => passes(l) && !mine[l.id])
    .sort((x, y) => (theirs[y.id] === 'like') - (theirs[x.id] === 'like'));
}

const matches = () => LISTINGS.filter((l) => state.swipes.a[l.id] === 'like' && state.swipes.b[l.id] === 'like');
const almosts = () => LISTINGS.filter((l) => {
  const a = state.swipes.a[l.id];
  const b = state.swipes.b[l.id];
  return (a === 'like' && b === 'pass') || (a === 'pass' && b === 'like');
});

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openOverlay(html, center = false) {
  const o = $('#overlay');
  o.innerHTML = `<div class="sheet${center ? ' center' : ''}">${html}</div>`;
  o.hidden = false;
  o.style.alignItems = center ? 'center' : 'flex-end';
}
function closeOverlay() {
  const o = $('#overlay');
  o.hidden = true;
  o.innerHTML = '';
  draftFilters = null;
}

// ---------- render ----------
function render() {
  const app = $('#app');
  if (state.setupStep < 2) { app.innerHTML = renderSetup(); return; }

  const n = matches().length;
  app.innerHTML = `
    <header class="topbar">
      <div class="logo">Nest<span>Match</span></div>
      <button class="who" data-act="switch" title="Switch partner">
        <i class="dot ${state.active}"></i>${nm(state.active)} ⇄
      </button>
      <button class="icon-btn" data-act="filters" title="Filters">⚙︎</button>
    </header>
    <main class="main">${
      state.view === 'swipe' ? renderSwipe() : state.view === 'matches' ? renderMatches() : renderFinal()
    }</main>
    <nav class="tabs">
      ${tab('swipe', '🏠', 'Swipe')}
      ${tab('matches', '💞', 'Matches', n)}
      ${tab('final', '🏆', 'Final Round')}
    </nav>`;

  if (state.view === 'swipe') {
    const top = $('.card:not(.behind)');
    if (top) attachDrag(top);
  }
}

function tab(view, ico, label, badge) {
  return `<button class="tab${state.view === view ? ' on' : ''}" data-act="view" data-view="${view}">
    <span class="ico">${ico}</span>${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
}

// ---------- setup ----------
function renderSetup() {
  if (state.setupStep === 0) {
    return `<main class="main">
      <div class="hero">
        <div class="steps"><i class="on"></i><i></i></div>
        <h1>Find the home you <em>both</em> love.</h1>
        <p>Each of you swipes on your own. When you both swipe right on the same house, it's a match. Then you narrow your matches down together until one is left.</p>
      </div>
      <div class="section-title">Who's house hunting?</div>
      <div class="field"><label for="na"><i class="dot a" style="display:inline-block"></i> Partner 1</label>
        <input id="na" type="text" maxlength="20" value="${nm('a')}"></div>
      <div class="field"><label for="nb"><i class="dot b" style="display:inline-block"></i> Partner 2</label>
        <input id="nb" type="text" maxlength="20" value="${nm('b')}"></div>
      <div style="flex:1"></div>
      <button class="btn accent" data-act="setup-names">Next: set your must-haves</button>
      <p class="demo-note">Demo with made-up sample homes. Everything is saved only on this device.</p>
    </main>`;
  }
  draftFilters = draftFilters || structuredClone(state.filters);
  return `<main class="main">
    <div class="hero">
      <div class="steps"><i class="on"></i><i class="on"></i></div>
      <h1>Set your filters together</h1>
      <p>Pick these together so you're both swiping the same short list instead of every home in town.</p>
    </div>
    ${renderFilterForm(draftFilters)}
    <button class="btn accent" data-act="setup-done">Start swiping</button>
    <button class="btn ghost" style="margin-top:8px" data-act="setup-back">Back</button>
  </main>`;
}

function renderFilterForm(f) {
  const count = LISTINGS.filter((l) => passes(l, f)).length;
  const seg = (key, opts) => `<div class="seg">${opts.map((v) =>
    `<button class="${f[key] === v ? 'on' : ''}" data-act="f-seg" data-key="${key}" data-val="${v}">${v === 0 ? 'Any' : v + '+'}</button>`).join('')}</div>`;
  const picks = (key, opts) => `<div class="picks">${opts.map((v) =>
    `<button class="pick${f[key].includes(v) ? ' on' : ''}" data-act="f-pick" data-key="${key}" data-val="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;

  return `
    <div class="section-title">Budget</div>
    <div class="field">
      <div class="range-row"><span id="minLbl">${shortMoney(f.minPrice)}</span><span id="maxLbl">${shortMoney(f.maxPrice)}</span></div>
      <label class="muted" for="minP" style="font-weight:500">Min</label>
      <input id="minP" type="range" min="${PRICE_MIN}" max="${PRICE_MAX}" step="25000" value="${f.minPrice}" data-act="f-range" data-key="minPrice">
      <label class="muted" for="maxP" style="font-weight:500">Max</label>
      <input id="maxP" type="range" min="${PRICE_MIN}" max="${PRICE_MAX}" step="25000" value="${f.maxPrice}" data-act="f-range" data-key="maxPrice">
    </div>
    <div class="section-title">Bedrooms</div>${seg('beds', [0, 1, 2, 3, 4, 5])}
    <div class="section-title">Bathrooms</div>${seg('baths', [0, 1, 2, 3])}
    <div class="section-title">Home type</div>${picks('types', TYPES)}
    <div class="section-title">Neighborhoods</div>${picks('hoods', HOODS.map((h) => h.name))}
    <div class="section-title">Must-haves</div>${picks('musts', FEATURES)}
    <div class="count-pill" id="countPill">${count} home${count === 1 ? '' : 's'} fit your filters</div>`;
}

function refreshFilterForm() {
  // re-render just the form wherever it lives (setup page or filter sheet), keeping scroll position
  const host = state.setupStep < 2 ? $('#app .main') : $('#overlay .sheet');
  const scroll = host.scrollTop;
  if (state.setupStep < 2) { $('#app').innerHTML = renderSetup(); } else { openFilters(true); }
  const h2 = state.setupStep < 2 ? $('#app .main') : $('#overlay .sheet');
  h2.scrollTop = scroll;
}

function openFilters(keepDraft = false) {
  if (!keepDraft || !draftFilters) draftFilters = structuredClone(state.filters);
  openOverlay(`
    <div class="sheet-head"><h2>Filters</h2><button class="icon-btn" data-act="close">✕</button></div>
    <p class="muted" style="margin:0">Filters are shared, so you both see the same homes.</p>
    ${renderFilterForm(draftFilters)}
    <div class="row">
      <button class="btn ghost" data-act="f-clear">Clear all</button>
      <button class="btn accent" data-act="f-apply">Show homes</button>
    </div>
    <button class="link-btn" style="width:100%;margin-top:14px;color:var(--accent)" data-act="reset">Reset the whole demo</button>`);
}

// ---------- swipe ----------
function renderSwipe() {
  const deck = deckFor(state.active);
  const total = LISTINGS.filter((l) => passes(l)).length;
  const summary = `<div class="filter-summary">
      <span>${shortMoney(state.filters.minPrice)}–${shortMoney(state.filters.maxPrice)} · ${deck.length} of ${total} left</span>
      <button data-act="filters">Edit filters</button></div>`;

  if (!deck.length) {
    const otherLeft = deckFor(other(state.active)).length;
    return `${summary}<div class="empty">
      <div class="big-emoji">🏁</div>
      <h2>You've seen every home that fits your filters</h2>
      <p>${otherLeft ? `${nm(other(state.active))} still has ${otherLeft} to go.` : 'You both finished this batch.'} You can also widen your filters to see more.</p>
      ${otherLeft ? `<button class="btn accent" data-act="switch">Hand the phone to ${nm(other(state.active))}</button>` : ''}
      <button class="btn ghost" data-act="filters">Widen filters</button>
    </div>`;
  }

  const [top, next] = deck;
  return `${summary}
    <div class="deck">
      ${next ? cardHTML(next, true) : ''}
      ${cardHTML(top, false)}
    </div>
    <div class="actions">
      <button class="round sm" data-act="undo" title="Undo" ${canUndo() ? '' : 'disabled'}>↺</button>
      <button class="round big pass" data-act="pass" title="Pass (←)">✕</button>
      <button class="round big like" data-act="like" title="Like (→)">♥</button>
      <button class="round sm" data-act="details" data-id="${top.id}" title="Details">i</button>
    </div>
    <p class="hint">Swipe or use ← → · tap the card for details</p>`;
}

function cardHTML(l, behind) {
  return `<article class="card${behind ? ' behind' : ''}" data-id="${l.id}">
    <div class="photo">${houseSVG(l)}
      <span class="type-tag">${l.type}</span>
      <span class="stamp like">LIKE</span><span class="stamp nope">NOPE</span>
    </div>
    <div class="card-body">
      <div class="price">${money(l.price)}</div>
      <div class="specs">${specs(l)}</div>
      <div class="addr">${l.address} · ${l.hood}</div>
      <div class="chips">${l.features.slice(0, 3).map((f) => `<span class="chip">${f}</span>`).join('')}${
        l.features.length > 3 ? `<span class="chip">+${l.features.length - 3}</span>` : ''}</div>
    </div>
  </article>`;
}

function attachDrag(card) {
  let sx = 0; let sy = 0; let dx = 0; let dragging = false; let moved = false;
  card.addEventListener('pointerdown', (e) => {
    if (animating || e.button !== 0) return;
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0;
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    card.style.transform = `translate(${dx}px, ${dy * 0.3}px) rotate(${dx / 16}deg)`;
    card.style.setProperty('--like', Math.max(0, Math.min(1, dx / 100)));
    card.style.setProperty('--nope', Math.max(0, Math.min(1, -dx / 100)));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = '';
    if (dx > 110) swipe('like');
    else if (dx < -110) swipe('pass');
    else {
      card.style.transform = '';
      card.style.setProperty('--like', 0);
      card.style.setProperty('--nope', 0);
      if (!moved) openDetails(card.dataset.id);
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function swipe(dir) {
  const card = $('.card:not(.behind)');
  if (!card || animating) return;
  animating = true;
  const id = card.dataset.id;
  card.style.transition = 'transform .3s ease';
  card.style.setProperty(dir === 'like' ? '--like' : '--nope', 1);
  card.style.transform = `translate(${dir === 'like' ? 520 : -520}px, 40px) rotate(${dir === 'like' ? 24 : -24}deg)`;
  setTimeout(() => {
    animating = false;
    const p = state.active;
    state.swipes[p][id] = dir;
    state.lastSwipe = { p, id };
    save();
    render();
    if (dir === 'like' && state.swipes[other(p)][id] === 'like') showMatch(id);
  }, 280);
}

const canUndo = () => state.lastSwipe && state.lastSwipe.p === state.active;
function undo() {
  if (!canUndo()) return;
  delete state.swipes[state.active][state.lastSwipe.id];
  state.lastSwipe = null;
  save();
  render();
}

function showMatch(id) {
  const l = byId[id];
  openOverlay(`
    <div class="match-title">It's a match!</div>
    <p>${nm('a')} and ${nm('b')} both love <b>${l.address}</b>.</p>
    <div class="hero-img">${houseSVG(l)}</div>
    <div class="price">${money(l.price)}</div>
    <p class="muted" style="margin:2px 0 16px">${specs(l)} · ${l.hood}</p>
    <div class="row">
      <button class="btn ghost" data-act="close">Keep swiping</button>
      <button class="btn accent" data-act="goto-matches">See matches</button>
    </div>`, true);
}

function openDetails(id) {
  const l = byId[id];
  const a = state.swipes.a[id];
  const b = state.swipes.b[id];
  // only reveal votes once both have swiped, so nobody is swayed
  const voteLine = a && b
    ? `<p class="votes">${voteTxt('a', a)} · ${voteTxt('b', b)}</p>` : '';
  openOverlay(`
    <div class="sheet-head"><h2>${money(l.price)}</h2><button class="icon-btn" data-act="close">✕</button></div>
    <div class="muted">${l.address} · ${l.hood}</div>
    ${voteLine}
    <div class="hero-img">${houseSVG(l)}</div>
    <div class="facts">
      <div class="fact"><b>${l.beds}</b><span>beds</span></div>
      <div class="fact"><b>${l.baths}</b><span>baths</span></div>
      <div class="fact"><b>${l.sqft.toLocaleString('en-US')}</b><span>sqft</span></div>
      <div class="fact"><b>${l.year}</b><span>built</span></div>
      <div class="fact"><b>${l.lot ? l.lot + ' ac' : '—'}</b><span>lot</span></div>
      <div class="fact"><b>${l.commute} min</b><span>commute</span></div>
    </div>
    <p>${l.description}</p>
    <div class="chips">${l.features.map((f) => `<span class="chip">${f}</span>`).join('')}</div>
    <p class="muted" style="font-size:13px">${l.type} · ${money(Math.round(l.price / l.sqft))}/sqft</p>`);
}
const voteTxt = (p, v) => `<span class="${v === 'like' ? 'y' : 'n'}">${nm(p)} ${v === 'like' ? '♥' : '✕'}</span>`;

function switchPartner() {
  const next = other(state.active);
  openOverlay(`
    <div class="big-emoji" style="font-size:44px">📱</div>
    <h2 style="margin:8px 0">Pass the phone to ${nm(next)}</h2>
    <p class="muted">Swipes stay private. You only see each other's picks once you both like a home.</p>
    <button class="btn accent" data-act="confirm-switch">I'm ${nm(next)}, let's go</button>
    <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button>`, true);
}

// ---------- matches ----------
function renderMatches() {
  const m = matches();
  const al = almosts();
  let html = `<h1 class="page-title">Your matches</h1>`;
  if (!m.length) {
    html += `<p class="muted">No matches yet. A match happens when you both swipe right on the same home.</p>`;
  } else {
    html += `<p class="muted" style="margin-top:0">${m.length} home${m.length === 1 ? '' : 's'} you both love.</p>`;
    if (m.length >= 2) html += `<button class="btn accent" style="margin:6px 0 14px" data-act="view" data-view="final">Narrow it down in the Final Round →</button>`;
    html += `<div class="list">${m.map((l) => itemHTML(l,
      `<button class="link-btn" style="color:var(--muted)" data-act="unmatch" data-id="${l.id}">Remove</button>`)).join('')}</div>`;
  }
  if (al.length) {
    html += `<div class="section-title">Almost: only one of you liked these</div>
      <div class="list">${al.map((l) => {
        const passer = state.swipes.a[l.id] === 'pass' ? 'a' : 'b';
        return itemHTML(l,
          `<button class="link-btn" data-act="second-look" data-id="${l.id}" data-p="${passer}">Ask ${nm(passer)}<br>to rethink</button>`,
          `<div class="votes">${voteTxt('a', state.swipes.a[l.id])} · ${voteTxt('b', state.swipes.b[l.id])}</div>`);
      }).join('')}</div>`;
  }
  return html;
}

function itemHTML(l, action, extra = '') {
  return `<div class="item">
    <div class="thumb">${houseSVG(l)}</div>
    <div class="info" data-act="details" data-id="${l.id}">
      <div class="p">${money(l.price)}</div>
      <div class="s">${specs(l)}</div>
      <div class="s">${l.address} · ${l.hood}</div>${extra}
    </div>${action}</div>`;
}

// ---------- final round ----------
// final = { pool: [ids], votes: {a, b}, phase: 'a' | 'b' | 'reveal', eliminated: [ids] }
function startFinal() {
  const ids = matches().map((l) => l.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  state.final = { pool: ids, votes: { a: null, b: null }, phase: 'a', eliminated: [] };
  state.winner = null;
  save();
  render();
}

function renderFinal() {
  if (state.winner) return renderWinner();
  const m = matches();
  const f = state.final;

  if (!f) {
    return `<h1 class="page-title">Final Round</h1>
      <p class="muted">Your matches go head to head, two at a time. You each pick a favorite without seeing the other's vote. If you agree, the other home is out. Keep going until one home is left.</p>
      ${m.length >= 2
        ? `<div class="count-pill">${m.length} matches ready</div><button class="btn accent" data-act="final-start">Start the Final Round</button>`
        : `<div class="callout"><h3>You need at least 2 matches</h3><p class="muted" style="margin:0">You have ${m.length}. Keep swiping and come back once you've both liked a few of the same homes.</p></div>
           <button class="btn ghost" style="margin-top:14px" data-act="view" data-view="swipe">Back to swiping</button>`}`;
  }

  const [x, y] = f.pool.slice(0, 2).map((id) => byId[id]);
  const total = f.pool.length + f.eliminated.length;
  const dots = `<div class="progress">${'<i></i>'.repeat(f.pool.length)}${'<i class="gone"></i>'.repeat(f.eliminated.length)}</div>`;
  let head;
  let foot = '';
  let pickable = false;

  if (f.phase === 'a' || f.phase === 'b') {
    pickable = true;
    head = `<h2>${nm(f.phase)}, which one do you like more?</h2>
      <p class="muted" style="margin:4px 0 0">${f.phase === 'a' ? `${nm('b')} votes next. Don't peek.` : `${nm('a')} already voted. Their pick stays hidden until you vote.`}</p>`;
  } else {
    const agree = f.votes.a === f.votes.b;
    const pickName = (id) => esc(byId[id].address);
    if (agree) {
      const loser = f.votes.a === x.id ? y : x;
      head = `<h2>You agree! 🎉</h2><p class="muted" style="margin:4px 0 0">You both picked ${pickName(f.votes.a)}. ${esc(loser.address)} is out.</p>`;
      foot = `<button class="btn accent" style="margin-top:14px" data-act="final-next">${f.pool.length === 2 ? 'Reveal your dream home' : 'Next matchup'}</button>`;
    } else {
      head = `<h2>Split decision</h2><p class="muted" style="margin:4px 0 0">${nm('a')} picked ${pickName(f.votes.a)}, ${nm('b')} picked ${pickName(f.votes.b)}.</p>`;
      foot = `<div class="callout"><h3>Talk it over</h3>
          <p class="muted" style="margin:0 0 10px">What does each of you love about your pick? Tap a home to compare everything.</p>
          <button class="btn accent" data-act="final-revote">Vote again</button>
          ${f.pool.length > 2
            ? `<button class="btn ghost" style="margin-top:8px" data-act="final-keep">Keep both for now</button>`
            : `<button class="btn ghost" style="margin-top:8px" data-act="cta" data-msg="Demo: this is where we'd book tours of both homes with a local agent.">Tour both in person</button>`}
        </div>`;
    }
  }

  const vcard = (l) => {
    let cls = '';
    if (f.phase === 'reveal') {
      if (f.votes.a === l.id) cls += ' picked-a';
      else if (f.votes.b === l.id) cls += ' picked-b';
      if (f.votes.a === f.votes.b && f.votes.a !== l.id) cls += ' out';
    }
    const tags = f.phase === 'reveal'
      ? ['a', 'b'].filter((p) => f.votes[p] === l.id).map((p) => `<span style="color:var(--${p === 'a' ? 'accent' : 'teal'})">${nm(p)} ✓</span>`).join(' ')
      : '';
    return `<button class="vcard${cls}" data-act="${pickable ? 'final-vote' : 'details'}" data-id="${l.id}">
      <div class="thumb-lg">${houseSVG(l)}</div>
      <div class="vb"><div class="p">${shortMoney(l.price)}</div>
        <div>${l.beds} bd · ${l.baths} ba</div><div class="muted">${l.hood}</div>
        <ul><li>${l.sqft.toLocaleString('en-US')} sqft</li><li>${l.commute} min commute</li>${l.features.slice(0, 2).map((t) => `<li>${t}</li>`).join('')}</ul>
        ${tags ? `<div style="margin-top:6px;font-weight:700">${tags}</div>` : ''}
      </div></button>`;
  };

  return `<div class="filter-summary" style="margin-top:6px"><span>${f.pool.length} of ${total} homes still in</span>
      <button data-act="final-restart">Restart</button></div>
    ${dots}${head}
    <div class="versus">${vcard(x)}${vcard(y)}</div>
    ${pickable ? `<p class="hint">Tap your favorite</p>` : ''}${foot}`;
}

function finalVote(id) {
  const f = state.final;
  f.votes[f.phase] = id;
  if (f.phase === 'a') {
    f.phase = 'b';
    save();
    // hand-off screen so partner B doesn't see A's choice
    openOverlay(`<div style="font-size:44px">🙈</div><h2 style="margin:8px 0">Hand the phone to ${nm('b')}</h2>
      <p class="muted">${nm('a')}'s vote is locked in and hidden.</p>
      <button class="btn accent" data-act="close">I'm ${nm('b')}, show me</button>`, true);
  } else {
    f.phase = 'reveal';
    save();
  }
  render();
}

function finalNext() {
  const f = state.final;
  const [x, y] = f.pool;
  const winner = f.votes.a;
  const loser = winner === x ? y : x;
  f.pool = f.pool.filter((id) => id !== x && id !== y);
  f.pool.push(winner); // winner goes to the back of the line to face someone new
  f.eliminated.push(loser);
  f.votes = { a: null, b: null };
  f.phase = 'a';
  if (f.pool.length === 1) state.winner = winner;
  save();
  render();
}

function renderWinner() {
  const l = byId[state.winner];
  return `<div class="empty" style="justify-content:flex-start;padding:10px 0">
    <div class="big-emoji">🏡</div>
    <div class="match-title">Your dream home</div>
    <p>${nm('a')} and ${nm('b')} agreed on it.</p>
    <div class="hero-img" style="width:100%;border-radius:16px;overflow:hidden;height:220px">${houseSVG(l)}</div>
    <div class="price">${money(l.price)}</div>
    <p>${specs(l)}<br>${l.address} · ${l.hood}</p>
    <button class="btn accent" data-act="cta" data-msg="Demo: this is where we'd connect you with a partner agent to book a tour.">Book a tour</button>
    <button class="btn ghost" data-act="cta" data-msg="Demo: this is where a partner lender would send a pre-approval offer.">Get pre-approved</button>
    <button class="link-btn" data-act="final-restart">Run the Final Round again</button>
  </div>`;
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'overlay') closeOverlay();
    return;
  }
  const { act, id } = el.dataset;
  switch (act) {
    case 'setup-names': {
      state.partners.a = $('#na').value.trim() || 'Partner 1';
      state.partners.b = $('#nb').value.trim() || 'Partner 2';
      state.setupStep = 1; save(); render(); break;
    }
    case 'setup-back': state.setupStep = 0; save(); render(); break;
    case 'setup-done':
      state.filters = draftFilters; draftFilters = null; state.setupStep = 2; save(); render(); break;

    case 'f-seg': draftFilters[el.dataset.key] = Number(el.dataset.val); refreshFilterForm(); break;
    case 'f-pick': {
      const arr = draftFilters[el.dataset.key];
      const v = el.dataset.val;
      draftFilters[el.dataset.key] = arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
      refreshFilterForm(); break;
    }
    case 'f-clear':
      draftFilters = { ...defaultFilters(), minPrice: PRICE_MIN, maxPrice: PRICE_MAX }; refreshFilterForm(); break;
    case 'f-apply': state.filters = draftFilters; save(); closeOverlay(); render(); break;
    case 'filters': openFilters(); break;
    case 'reset':
      if (confirm('Reset all swipes, matches and names?')) {
        localStorage.removeItem(STORE_KEY); state = defaultState(); closeOverlay(); render();
      }
      break;

    case 'view': state.view = el.dataset.view; save(); closeOverlay(); render(); break;
    case 'switch': switchPartner(); break;
    case 'confirm-switch': state.active = other(state.active); save(); closeOverlay(); render(); break;
    case 'like': swipe('like'); break;
    case 'pass': swipe('pass'); break;
    case 'undo': undo(); break;
    case 'details': openDetails(id); break;
    case 'close': closeOverlay(); break;
    case 'goto-matches': state.view = 'matches'; save(); closeOverlay(); render(); break;

    case 'unmatch':
      state.swipes[state.active][id] = 'pass';
      if (state.final) state.final = null; // match list changed; restart the bracket
      save(); render(); toast('Removed from matches'); break;
    case 'second-look':
      delete state.swipes[el.dataset.p][id];
      save(); render();
      toast(`It'll show up again in ${state.partners[el.dataset.p]}'s deck`); break;

    case 'final-start': startFinal(); break;
    case 'final-restart': state.final = null; state.winner = null; save(); render(); break;
    case 'final-vote': finalVote(id); break;
    case 'final-next': finalNext(); break;
    case 'final-revote': state.final.votes = { a: null, b: null }; state.final.phase = 'a'; save(); render(); break;
    case 'final-keep': {
      const f = state.final;
      f.pool.push(f.pool.shift(), f.pool.shift());
      f.votes = { a: null, b: null }; f.phase = 'a'; save(); render(); break;
    }
    case 'cta': toast(el.dataset.msg); break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.act !== 'f-range') return;
  const key = el.dataset.key;
  let v = Number(el.value);
  // keep min below max
  if (key === 'minPrice' && v > draftFilters.maxPrice) v = draftFilters.maxPrice;
  if (key === 'maxPrice' && v < draftFilters.minPrice) v = draftFilters.minPrice;
  el.value = v;
  draftFilters[key] = v;
  $('#minLbl').textContent = shortMoney(draftFilters.minPrice);
  $('#maxLbl').textContent = shortMoney(draftFilters.maxPrice);
  const n = LISTINGS.filter((l) => passes(l, draftFilters)).length;
  $('#countPill').textContent = `${n} home${n === 1 ? '' : 's'} fit your filters`;
});

document.addEventListener('keydown', (e) => {
  if (state.setupStep < 2 || state.view !== 'swipe' || !$('#overlay').hidden) return;
  if (e.key === 'ArrowRight') swipe('like');
  if (e.key === 'ArrowLeft') swipe('pass');
});

render();
