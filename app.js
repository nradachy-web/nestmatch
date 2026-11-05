// NestMatch: each partner swipes on their own. Both like it → match.
// Matches can be compared and analyzed, then go head to head in the Final Round until one home is left.

const STORE_KEY = 'nestmatch-v2';
const GROUPS_KEY = 'nestmatch-groups-v1'; // owned by groups.js

const defaultPartner = (name, work) => ({ name, work, maxCommute: 0, dealbreakers: [], nice: [] });
const defaultFilters = () => ({
  minPrice: 0, maxPrice: 0,
  // multi-select: each holds the options picked (empty = any)
  monthly: [], beds: [], baths: [], sizes: [], hoa: [], styles: [], hoods: [],
  hideHighFlood: false,
});
// option value -> label; a listing falls in the last bucket whose bound it reaches
const MONTHLY_BUCKETS = [[0, 'Under $2.5k'], [2500, '$2.5k–3.5k'], [3500, '$3.5k–4.5k'], [4500, '$4.5k–6k'], [6000, '$6k+']];
const SIZE_BUCKETS = [[0, 'Under 1,500'], [1500, '1,500–2,000'], [2000, '2,000–2,500'], [2500, '2,500–3,000'], [3000, '3,000+']];
const BED_OPTS = [[2, '2'], [3, '3'], [4, '4'], [5, '5+']];
const BATH_OPTS = [[1, '1'], [2, '2'], [3, '3'], [4, '4+']];
const HOA_OPTS = [['none', 'No HOA'], ['low', 'Under $100/mo'], ['high', '$100+/mo']];
// values below the lowest bound (say a 1-bed live listing) count as the lowest bucket
const bucket = (v, opts) => String((opts.filter(([b]) => v >= b).pop() || opts[0])[0]);
const hoaKey = (l) => (!l.hoa ? 'none' : l.hoa < 100 ? 'low' : 'high');
const defaultState = () => ({
  market: SAMPLE_MARKET, // saved swipes only make sense for the sample market they were made in
  town: null, // the one town being swiped right now, so the deck stays short
  setupStep: 0, // 0 welcome, 1 partner A prefs, 2 partner B prefs, 3 shared filters, 4 done
  partners: { a: defaultPartner('Taylor', 'downtown'), b: defaultPartner('Nick', 'troy') },
  active: 'a',
  filters: defaultFilters(),
  finance: { down: 10, rate: 6.5 },
  swipes: { a: {}, b: {} },
  reasons: { a: {}, b: {} },
  lastSwipe: null,
  lastReason: null, // the why-not answer tied to lastSwipe, so undo can take it back
  view: 'swipe',
  matchesMode: 'list',
  matchSort: 'fit',
  compare: [],
  final: null,
  winner: null,
  agentRequest: null,
  reactions: {}, // listing id -> { a: emoji, b: emoji }
  stats: { rethinks: 0, finals: 0 },
  badges: [], // names of badges already earned (so each unlock is announced once)
  source: 'sample',
  live: null,
});

let state = load();
let animating = false;
let whyNot = null; // { id, p } after a left swipe
let sheet = null; // { name, arg } for the open overlay
let serverLive = null; // null = unknown/static server, true/false = node server reports key
let prefsWho = null; // whose preferences the Preferences sheet is showing
let liveForm = { city: '', state: '', busy: false, error: '' };
const appMaps = [];
const sheetMaps = [];

function load() {
  const d = defaultState();
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (!s || typeof s !== 'object') return d;
    const obj = (v, fb) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fb);
    if (s.market !== SAMPLE_MARKET) {
      // the sample homes changed (e.g. Houston -> Michigan): keep names and loan settings, start swiping fresh
      const keep = (q) => ({ ...d.partners[q], name: typeof s.partners?.[q]?.name === 'string' && s.partners[q].name ? s.partners[q].name : d.partners[q].name });
      return { ...d, partners: { a: keep('a'), b: keep('b') }, finance: { ...d.finance, ...obj(s.finance, {}) }, setupStep: Math.min(Number(s.setupStep) || 0, 1) };
    }
    const partner = (v, fb) => {
      const m = { ...fb, ...obj(v, {}) };
      if (!Array.isArray(m.dealbreakers)) m.dealbreakers = [];
      if (!Array.isArray(m.nice)) m.nice = [];
      if (typeof m.name !== 'string' || !m.name) m.name = fb.name;
      if (!WORK_HUBS[m.work]) m.work = fb.work;
      return m;
    };
    const filters = { ...d.filters, ...obj(s.filters, {}) };
    ['monthly', 'beds', 'baths', 'sizes', 'hoa', 'styles', 'hoods'].forEach((k) => { if (!Array.isArray(filters[k])) filters[k] = []; });
    ['maxMonthly', 'minSqft', 'maxHoa'].forEach((k) => delete filters[k]); // older single-choice filters
    filters.hoods = filters.hoods.filter((h) => HOODS.some((x) => x.name === h));
    return {
      ...d, ...s,
      partners: { a: partner(s.partners?.a, d.partners.a), b: partner(s.partners?.b, d.partners.b) },
      filters,
      finance: { ...d.finance, ...obj(s.finance, {}) },
      swipes: { a: obj(s.swipes?.a, {}), b: obj(s.swipes?.b, {}) },
      reasons: { a: obj(s.reasons?.a, {}), b: obj(s.reasons?.b, {}) },
      compare: Array.isArray(s.compare) ? s.compare : [],
      reactions: obj(s.reactions, {}),
      stats: { ...d.stats, ...obj(s.stats, {}) },
      badges: Array.isArray(s.badges) ? s.badges : [],
      active: s.active === 'b' ? 'b' : 'a',
      town: typeof s.town === 'string' ? s.town : null,
      final: s.final && Array.isArray(s.final.pool) && Array.isArray(s.final.out) && s.final.votes ? s.final : null,
    };
  } catch (e) { /* fall through */ }
  return d;
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// ---------- data ----------
function listings() {
  return state.source === 'live' && state.live ? state.live.listings : SAMPLE_LISTINGS;
}
let byIdCache = { src: null, map: {} };
function byId(id) {
  const src = listings();
  if (byIdCache.src !== src) byIdCache = { src, map: Object.fromEntries(src.map((l) => [l.id, l])) };
  return byIdCache.map[id];
}
function priceBounds() {
  const prices = listings().map((l) => l.price);
  return {
    lo: Math.floor(Math.min(...prices) / 50000) * 50000,
    hi: Math.ceil(Math.max(...prices) / 50000) * 50000,
  };
}
const styleOptions = () => [...new Set(listings().map((l) => l.style))].sort();
const hoodOptions = () => [...new Set(listings().map((l) => l.hood))].sort();

function mapRentcast(r) {
  const hash = [...String(r.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return {
    id: `rc-${r.id}`,
    source: 'live',
    flip: false,
    photos: [PLACEHOLDER_PHOTOS[hash % PLACEHOLDER_PHOTOS.length]],
    placeholderPhoto: true,
    style: r.propertyType || 'Home',
    stories: null,
    price: r.price || 0,
    originalPrice: r.price || 0,
    beds: r.bedrooms || 0,
    baths: r.bathrooms || 0,
    sqft: r.squareFootage || 0,
    lotSqft: r.lotSize || null,
    year: r.yearBuilt || null,
    garage: null,
    hood: r.zipCode ? `ZIP ${r.zipCode}` : r.city,
    city: r.city,
    state: r.state,
    zip: r.zipCode,
    address: r.addressLine1 || r.formattedAddress || 'Address not provided',
    lat: r.latitude,
    lng: r.longitude,
    features: [],
    hoa: (r.hoa && r.hoa.fee) || 0,
    taxRate: 0.018,
    dom: r.daysOnMarket ?? null,
    school: null,
    flood: null,
    description: `${r.propertyType || 'Home'} for sale${r.mlsName ? `, listed on ${r.mlsName}` : ''}. Full photos, features and the agent's description come with an MLS/IDX connection.`,
    office: (r.listingOffice && r.listingOffice.name) || 'Listing brokerage not provided',
  };
}

// ---------- money / commute / fit ----------
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const shortMoney = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1000)}k`);
const num = (n) => Math.round(n).toLocaleString('en-US');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const nm = (p) => esc(state.partners[p].name);
const other = (p) => (p === 'a' ? 'b' : 'a');
const isLike = (v) => v === 'like' || v === 'love';

function payment(l) {
  const { down, rate } = state.finance;
  const loan = l.price * (1 - down / 100);
  const r = rate / 100 / 12;
  const n = 360;
  const pi = r ? (loan * r) / (1 - (1 + r) ** -n) : loan / n;
  const tax = (l.price * l.taxRate) / 12;
  const ins = (l.price * 0.005) / 12; // homeowners insurance, a rough national-average rate
  const pmi = down < 20 ? (loan * 0.005) / 12 : 0;
  return { pi, tax, ins, pmi, hoa: l.hoa || 0, total: pi + tax + ins + pmi + (l.hoa || 0) };
}

function commute(l, p) {
  const hub = WORK_HUBS[state.partners[p].work];
  if (!hub || hub.lat == null || l.lat == null) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(hub.lat - l.lat);
  const dLng = toRad(hub.lng - l.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(l.lat)) * Math.cos(toRad(hub.lat)) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.asin(Math.sqrt(a));
  return Math.round(km * 1.55 + 5); // rough rush-hour drive estimate
}

function fit(l, p) {
  const nice = state.partners[p].nice;
  if (!nice.length) return null;
  const hits = nice.filter((f) => l.features.includes(f));
  return { hits, total: nice.length, pct: Math.round((hits.length / nice.length) * 100) };
}

// ---------- filtering ----------
function breaksDealbreaker(l, p) {
  const pr = state.partners[p];
  if (pr.dealbreakers.some((d) => DEALBREAKERS[d] && !DEALBREAKERS[d](l))) return true;
  const c = commute(l, p);
  return Boolean(pr.maxCommute && c != null && c > pr.maxCommute);
}
function passesFilters(l, f = state.filters) {
  return (!f.minPrice || l.price >= f.minPrice) && (!f.maxPrice || l.price <= f.maxPrice)
    && (!f.monthly.length || f.monthly.includes(bucket(payment(l).total, MONTHLY_BUCKETS)))
    && (!f.beds.length || f.beds.includes(bucket(l.beds, BED_OPTS)))
    && (!f.baths.length || f.baths.includes(bucket(Math.floor(l.baths), BATH_OPTS)))
    && (!f.sizes.length || f.sizes.includes(bucket(l.sqft, SIZE_BUCKETS)))
    && (!f.hoa.length || f.hoa.includes(hoaKey(l)))
    && (!f.styles.length || f.styles.includes(l.style))
    && (!f.hoods.length || f.hoods.includes(l.hood))
    && !(f.hideHighFlood && l.flood === 'High');
}
// The shared pool: passes the shared filters and neither partner's dealbreakers.
const inPool = (l) => passesFilters(l) && !breaksDealbreaker(l, 'a') && !breaksDealbreaker(l, 'b');
const pool = () => listings().filter(inPool);

// Towns you can swipe: the neighborhoods you picked (or every one with homes), most homes first.
function townOptions() {
  const pl = pool();
  const names = [...new Set(pl.map((l) => l.hood))];
  return names.map((name) => {
    const homes = pl.filter((l) => l.hood === name);
    const left = (p) => homes.filter((l) => !state.swipes[p][l.id]).length;
    return { name, homes, total: homes.length, leftA: left('a'), leftB: left('b'), matched: homes.filter((l) => isLike(state.swipes.a[l.id]) && isLike(state.swipes.b[l.id])).length };
  }).sort((x, y) => (y.leftA + y.leftB > 0) - (x.leftA + x.leftB > 0) || y.total - x.total || x.name.localeCompare(y.name));
}
// the current town only counts if it still has homes under today's filters
const currentTown = () => (state.town && pool().some((l) => l.hood === state.town) ? state.town : null);
const townPool = () => pool().filter((l) => l.hood === currentTown());

function deckFor(p) {
  const mine = state.swipes[p];
  const theirs = state.swipes[other(p)];
  // Homes the partner already liked come first so matches show up sooner (the swiper doesn't see this).
  return townPool()
    .filter((l) => !mine[l.id])
    .sort((x, y) => (isLike(theirs[y.id]) - isLike(theirs[x.id])) || ((x.dom ?? 99) - (y.dom ?? 99)));
}

const matches = () => listings().filter((l) => isLike(state.swipes.a[l.id]) && isLike(state.swipes.b[l.id]));
const almosts = () => listings().filter((l) => {
  const a = state.swipes.a[l.id];
  const b = state.swipes.b[l.id];
  return a && b && isLike(a) !== isLike(b);
});

// ---------- icons ----------
const ICON = {
  heart: '<path d="M12 20.5s-7.6-4.6-9.4-9.3C1.4 7.9 3.6 4.6 7 4.6c2 0 3.4 1.1 5 2.9 1.6-1.8 3-2.9 5-2.9 3.4 0 5.6 3.3 4.4 6.6-1.8 4.7-9.4 9.3-9.4 9.3z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  home: '<path d="M3.5 10.5L12 4l8.5 6.5V20a1 1 0 01-1 1H15v-6H9v6H4.5a1 1 0 01-1-1z"/>',
  matches: '<path d="M8.5 18.5s-5.5-3.3-6.6-6.6C1 9.5 2.6 7 5 7c1.4 0 2.4.8 3.5 2 1.1-1.2 2.1-2 3.5-2"/><path d="M15.5 20s-5.5-3.3-6.6-6.6C8 11 9.6 8.5 12 8.5c1.4 0 2.4.8 3.5 2 1.1-1.2 2.1-2 3.5-2 2.4 0 4 2.5 3.1 4.9-1.1 3.3-6.6 6.6-6.6 6.6z"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M2.5 20.5h19"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  pin: '<path d="M12 21s6.5-5.8 6.5-11A6.5 6.5 0 005.5 10c0 5.2 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  bed: '<path d="M3 19v-9M3 15h18v4M21 15v-2a3 3 0 00-3-3h-7v5"/><circle cx="7" cy="12" r="1.6"/>',
  bath: '<path d="M4 12h16v2.5A4.5 4.5 0 0115.5 19h-7A4.5 4.5 0 014 14.5zM6 12V6.5a2 2 0 014 0M7.5 19l-1 2M16.5 19l1 2"/>',
  area: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 10h6V4"/>',
  car: '<path d="M4 16.5V13l2.2-5h11.6L20 13v3.5"/><path d="M3 13h18v4H3zM7 17v2M17 17v2"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  school: '<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 11v4.5c3 2 8 2 11 0V11"/>',
  drop: '<path d="M12 3.5s6 6.3 6 10.5a6 6 0 01-12 0c0-4.2 6-10.5 6-10.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  map: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1"/>',
  columns: '<rect x="3.5" y="4.5" width="7" height="15" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="15" rx="1.5"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c1-3.9 4-5.8 7.5-5.8s6.5 1.9 7.5 5.8"/>',
  swap: '<path d="M7 4L3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
  share: '<path d="M4.5 12.5v6.5a1 1 0 001 1h13a1 1 0 001-1v-6.5M12 3.5v12M8 7.5l4-4 4 4"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="1.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3-8.7 8.7z"/><circle cx="8" cy="8" r="1.3"/>',
  sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 018 0v2.5"/>',
  wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2"/><path d="M15.5 12.5h5M3.5 9.5h17"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

// ---------- small UI helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${msg}</span>${action ? `<button data-act="${action.act}" ${action.data || ''}>${action.label}</button>` : ''}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, action ? 4500 : 2600);
}

// Feed-tuning suggestions. On phones they show inline under the card instead of as a toast,
// because a toast button up top would sit over the top-bar icons.
let suggestBar = null;
const isPhone = () => matchMedia('(max-width: 959px)').matches;
function suggest(msg, action) {
  if (!isPhone()) return toast(msg, action);
  suggestBar = { p: state.active, msg, action };
  $('#toast').hidden = true;
  render();
}
const suggestHTML = () => `<div class="whynot suggest"><span class="suggest-msg">${suggestBar.msg}</span>
  <button data-act="${suggestBar.action.act}" ${suggestBar.action.data || ''}>${suggestBar.action.label}</button>
  <button class="skip" data-act="suggest-skip" aria-label="Dismiss">${icon('x')}</button></div>`;

function photoTag(l, i, cls = '') {
  const src = l.photos[i] || l.photos[0];
  const flip = l.flip && i === 0 ? ' flip' : '';
  return `<img class="${cls}${flip}" src="${src}" alt="" draggable="false" loading="lazy">`;
}

function chipsFor(l, p) {
  const out = [];
  const c = commute(l, p);
  if (c != null) out.push(`<span class="chip">${icon('car')}${c} min to ${esc(WORK_HUBS[state.partners[p].work].name)}</span>`);
  if (l.school) out.push(`<span class="chip">${icon('school')}Schools ${l.school}/10</span>`);
  if (l.flood && l.flood !== 'Minimal') out.push(`<span class="chip ${l.flood === 'High' ? 'warn' : ''}">${icon('drop')}${l.flood} flood risk</span>`);
  return out.join('');
}

// ---------- fun ----------
// A playful one-liner per home; the first rule that applies wins.
const VIBES = [
  [(l) => l.features.includes('Pool'), 'Pool party ready'],
  [(l) => l.features.includes('Updated kitchen'), "Chef's kitchen"],
  [(l) => ['a', 'b'].some((p) => commute(l, p) != null) && ['a', 'b'].every((p) => { const c = commute(l, p); return c == null || c <= 20; }), 'Commute hero'],
  [(l) => l.features.includes('Big yard'), "A dog's dream yard"],
  [(l) => l.beds >= 5, 'Room to grow'],
  [(l) => l.features.includes('Home office'), 'Work-from-home ready'],
  [(l) => l.features.includes('Fireplace'), 'Cozy-night certified'],
  [(l) => l.features.includes('Covered patio'), 'Built for backyard BBQs'],
  [(l) => l.year && l.year >= 2015, 'Practically brand new'],
  [(l) => l.year && l.year < 1960, 'Old-school charm'],
];
const vibe = (l) => (VIBES.find(([test]) => test(l)) || [])[1];

const MATCH_TITLES = ["It's a match", 'Love at first sight', 'You both said yes', 'Dream team', 'Great minds'];
const MILESTONE_LINES = ['On a roll!', 'Look at you go!', 'Ten more down!', 'Speed round champ!', 'Keep it up!'];
const REACTIONS = [['😍', 'Obsessed'], ['🤩', 'Wow'], ['🤔', 'Hmm'], ['💸', 'Pricey'], ['🔧', 'Needs work']];

function confetti(big = false) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['var(--brand, #1F3D35)', 'var(--brass, #A98552)', 'var(--ok)', 'var(--love)', '#ffffff'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  for (let i = 0; i < (big ? 110 : 60); i++) {
    const bit = document.createElement('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = colors[i % colors.length];
    bit.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 140}px`);
    bit.style.setProperty('--r', `${Math.random() * 900}deg`);
    bit.style.animationDelay = `${Math.random() * 0.3}s`;
    bit.style.animationDuration = `${1.3 + Math.random() * 1.1}s`;
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3000);
}

function syncStats() {
  const both = listings().filter((l) => state.swipes.a[l.id] && state.swipes.b[l.id]);
  const agree = both.filter((l) => isLike(state.swipes.a[l.id]) === isLike(state.swipes.b[l.id])).length;
  return { both: both.length, agree, score: both.length ? Math.round((agree / both.length) * 100) : 0 };
}

const BADGES = [
  ['First spark', 'Get your first match', 'heart', () => matches().length >= 1],
  ['High five', 'Reach 5 matches', 'matches', () => matches().length >= 5],
  ['Swipe stars', 'Swipe on 50 homes between you', 'sparkle', () => Object.keys(state.swipes.a).length + Object.keys(state.swipes.b).length >= 50],
  ['Super fans', 'Both "love" the same home', 'star', () => listings().some((l) => state.swipes.a[l.id] === 'love' && state.swipes.b[l.id] === 'love')],
  ['Mind meld', 'Be 80% in sync after 10 shared homes', 'chart', () => { const s = syncStats(); return s.both >= 10 && s.score >= 80; }],
  ['Open minds', 'Ask your partner for a second look', 'undo', () => state.stats.rethinks > 0],
  ['Champions', 'Finish a Final Round together', 'trophy', () => state.stats.finals > 0],
];
function checkBadges() {
  if (state.setupStep < 4) return;
  const fresh = BADGES.filter(([name, , , test]) => !state.badges.includes(name) && test()).map(([name]) => name);
  if (!fresh.length) return;
  state.badges.push(...fresh);
  save();
  setTimeout(() => toast(`${icon('trophy')} Badge unlocked: <b>${fresh[0]}</b>${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, { act: 'view', label: 'See', data: 'data-view="insights"' }), 900);
}

// Couple "home personality" from the homes you both liked.
const share = (ls, test) => (ls.length ? ls.filter(test).length / ls.length : 0);
const PERSONAS = [
  { name: 'The Poolside Pair', blurb: 'Summer is your season. Sunscreen, floaties and a grill within reach.', test: (l) => l.features.includes('Pool') },
  { name: 'The Cozy Homebodies', blurb: 'Fireplaces, character and a good blanket. You want a home that feels like a hug.', test: (l) => l.features.includes('Fireplace') || ['Craftsman', 'Tudor'].includes(l.style) },
  { name: 'The Modern Minimalists', blurb: 'Clean lines, big windows and a smart thermostat that knows you.', test: (l) => l.style === 'Modern' || l.features.includes('Smart home') || (l.year || 0) >= 2015 },
  { name: 'The Suburban Dreamers', blurb: 'A big yard, great schools and room for whoever comes next.', test: (l) => l.features.includes('Big yard') || l.beds >= 5 },
  { name: 'The Hosts With the Most', blurb: 'Open kitchens and covered patios. Your place is where everyone ends up.', test: (l) => ['Open floor plan', 'Covered patio', 'Updated kitchen'].some((f) => l.features.includes(f)) },
  { name: 'The Commute Crushers', blurb: 'Time is the real luxury. You want to live close to the action.', test: (l) => { const c = avgCommute(l); return c > 0 && c <= 25; } },
];
function persona() {
  const m = matches();
  if (m.length < 3) return null;
  const ranked = PERSONAS.map((p) => ({ ...p, pct: share(m, p.test) })).sort((x, y) => y.pct - x.pct);
  return { ...ranked[0], count: m.length, runnerUp: ranked[1] };
}

function reactionRow(l) {
  const r = state.reactions[l.id] || {};
  const p = state.active;
  const theirs = r[other(p)];
  return `<div class="reactions">
    <span class="label">${nm(p)}, your reaction</span>
    <div class="react-btns">${REACTIONS.map(([e, label]) => `<button class="react${r[p] === e ? ' on' : ''}" data-act="react" data-id="${l.id}" data-val="${e}" title="${label}">${e}</button>`).join('')}</div>
    ${theirs ? `<span class="their-react"><span class="avatar ${other(p)} xs">${nm(other(p)).charAt(0)}</span>reacted ${theirs}</span>` : ''}
  </div>`;
}

// The Final Round drops homes that are no longer matches (undo, remove, data change).
function sanitizeFinal() {
  const matched = new Set(matches().map((l) => l.id));
  // compare picks and reactions only make sense for current matches
  state.compare = state.compare.filter((id) => matched.has(id));
  // reactions are kept for unmatched homes so an undo and re-match brings them back; only drop vanished listings
  Object.keys(state.reactions).forEach((id) => { if (!byId(id)) delete state.reactions[id]; });
  if (state.winner && !matched.has(state.winner)) state.winner = null;
  const f = state.final;
  if (!f) return;
  const pair = f.pool.slice(0, 2).join();
  const before = f.pool.length;
  f.pool = f.pool.filter((id) => matched.has(id));
  f.out = f.out.filter((id) => byId(id));
  // only restart the vote if one of the two homes on screen went away
  if (f.pool.length !== before && f.pool.slice(0, 2).join() !== pair) { f.votes = { a: null, b: null }; f.phase = 'a'; state.active = 'a'; }
  if (!state.winner && f.pool.length < 2) {
    state.final = null;
    setTimeout(() => toast(f.pool.length
      ? 'Final Round ended: only one home is left in it. Match at least one more home to play again.'
      : 'Final Round ended: none of its homes are matches anymore.'), 0);
  }
}

// ---------- shell ----------
function render() {
  try { renderUnsafe(); } catch (err) {
    console.error(err);
    $('#app').innerHTML = `<div class="empty" style="margin:24px"><h2>Something went wrong</h2><p>Your saved demo data looks damaged.</p><button class="btn primary" data-act="hard-reset">Reset the demo</button></div>`;
  }
}
function renderUnsafe() {
  // groups.js (family / solo modes) can take over the whole app; couple mode is this file
  if (window.NMGroups && NMGroups.takeover()) { appMaps.splice(0).forEach((m) => m.remove()); NMGroups.render($('#app')); return; }
  sanitizeFinal();
  if (state.setupStep >= 4) save();
  checkBadges();
  appMaps.splice(0).forEach((m) => m.remove());
  const app = $('#app');
  const prevMain = $('.main', app);
  const keepScroll = prevMain && prevMain.dataset.view === currentViewKey() ? prevMain.scrollTop : 0;

  if (state.setupStep < 4) {
    app.innerHTML = `<div class="onboard"><div class="main" data-view="${currentViewKey()}">${renderSetup()}</div></div>`;
  } else {
    const n = matches().length;
    const views = { swipe: renderSwipe, matches: renderMatches, insights: renderInsights, final: renderFinal };
    app.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand">${brandMark()}<span>NestMatch</span></div>
          <nav class="side-nav">
            ${navItem('swipe', 'home', 'Discover')}
            ${navItem('matches', 'matches', 'Matches', n)}
            ${navItem('insights', 'chart', 'Us')}
            ${navItem('final', 'trophy', 'Final Round')}
          </nav>
          <div class="side-foot">
            ${partnerSwitch()}
            <button class="side-link" data-act="sheet" data-name="filters">${icon('sliders')}Filters</button>
            <button class="side-link" data-act="sheet" data-name="prefs">${icon('user')}Preferences & data</button>
            <p class="side-src">${sourceLabel()}</p>
          </div>
        </aside>
        <div class="content">
          <header class="topbar">
            <div class="brand">${brandMark()}<span>NestMatch</span></div>
            ${partnerSwitch()}
            <button class="icon-btn" data-act="sheet" data-name="filters" aria-label="Filters">${icon('sliders')}</button>
            <button class="icon-btn" data-act="sheet" data-name="prefs" aria-label="Preferences">${icon('user')}</button>
          </header>
          <main class="main view-${state.view}" data-view="${currentViewKey()}">${views[state.view]()}</main>
          <nav class="tabs">
            ${navItem('swipe', 'home', 'Discover')}
            ${navItem('matches', 'matches', 'Matches', n)}
            ${navItem('insights', 'chart', 'Us')}
            ${navItem('final', 'trophy', 'Final')}
          </nav>
        </div>
      </div>`;
  }

  const main = $('.main', app);
  if (main && keepScroll) main.scrollTop = keepScroll;
  if (state.setupStep >= 4 && state.view === 'swipe') {
    const top = $('.card:not(.behind)', app);
    if (top) attachDrag(top);
  }
  mountMaps(app, appMaps);
  if (window.NMGroups) NMGroups.afterRender(app);
}
const currentViewKey = () => (state.setupStep < 4 ? `setup${state.setupStep}` : `${state.view}-${state.matchesMode}`);

const brandMark = () => `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#111418"/><path d="M16 7.5l8.5 6.6V24h-17v-9.9z" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 21.6s-3.8-2.3-3.8-4.8a1.9 1.9 0 013.8-.6 1.9 1.9 0 013.8.6c0 2.5-3.8 4.8-3.8 4.8z" fill="#E5484D"/></svg>`;

function navItem(view, ico, label, badge) {
  return `<button class="nav-item${state.view === view ? ' on' : ''}" data-act="view" data-view="${view}">
    ${icon(ico)}<span>${label}</span>${badge ? `<b class="badge">${badge}</b>` : ''}</button>`;
}
function partnerSwitch() {
  return `<button class="who" data-act="switch" title="Switch partner">
    <span class="avatar ${state.active}">${nm(state.active).charAt(0)}</span><span class="who-name">${nm(state.active)}</span>${icon('swap')}</button>`;
}
function sourceLabel() {
  return state.source === 'live' && state.live
    ? `Live listings · ${esc(state.live.city)}, ${esc(state.live.state)} · via RentCast`
    : `Sample market · ${SAMPLE_MARKET}`;
}

// ---------- onboarding ----------
function renderSetup() {
  const s = state.setupStep;
  const steps = `<div class="steps">${[0, 1, 2, 3].map((i) => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>`;
  if (s === 0) {
    const pics = [2, 9, 12].map((n) => `<img src="${PHOTO_BASE}home${n}.jpg" alt="" draggable="false">`).join('');
    return `<div class="setup">
      <div class="collage">${pics}</div>
      <div class="brand big">${brandMark()}<span>NestMatch</span></div>
      <h1>Find the home you <em>both</em> love.</h1>
      <p class="lede">Each of you swipes on your own. A home only shows up as a match when you both say yes. Then NestMatch helps you narrow it down to one.</p>
      <ul class="value">
        <li>${icon('lock')}<span><b>Private swipes.</b> Nobody sees a "no" unless you both swiped.</span></li>
        <li>${icon('wallet')}<span><b>Real costs.</b> Monthly payment, taxes, HOA and commute on every home.</span></li>
        <li>${icon('chart')}<span><b>See where you differ.</b> We spot the patterns so you can talk them out.</span></li>
      </ul>
      <div class="two">
        <label class="field"><span>Partner 1</span><input id="na" type="text" maxlength="20" value="${nm('a')}"></label>
        <label class="field"><span>Partner 2</span><input id="nb" type="text" maxlength="20" value="${nm('b')}"></label>
      </div>
      <button class="btn primary" data-act="setup-names">Get started</button>
      <p class="fine">Demo with sample listings. Saved only in this browser.</p>
    </div>`;
  }
  if (s === 1 || s === 2) {
    const p = s === 1 ? 'a' : 'b';
    return `<div class="setup">
      ${steps}
      ${p === 'b' ? `<div class="handoff-note">${icon('swap')} Hand the device to ${nm('b')}</div>` : ''}
      <h1>${nm(p)}, what matters to you?</h1>
      <p class="lede">You each set your own. Dealbreakers hide homes for both of you, so you never waste a swipe on a home one of you would never buy.</p>
      ${prefsForm(p)}
      <div class="poolcount">${icon('home')}<span><b>${pool().length}</b> of ${listings().length} homes pass both of your dealbreakers</span></div>
      <div class="two"><button class="btn ghost" data-act="setup-back">Back</button>
      <button class="btn primary" data-act="setup-next">${p === 'a' ? `Next: ${nm('b')}` : 'Next: budget'}</button></div>
    </div>`;
  }
  return `<div class="setup">
    ${steps}
    <h1>Set your budget together</h1>
    <p class="lede">These filters are shared. You'll both swipe on the same short list.</p>
    ${filtersForm()}
    <div class="two"><button class="btn ghost" data-act="setup-back">Back</button>
    <button class="btn primary" data-act="setup-done" ${pool().length ? '' : 'disabled'}>Start swiping</button></div>
  </div>`;
}

function picks(act, key, options, selected, extra = '') {
  return `<div class="picks">${options.map((v) => `<button class="pick${selected.includes(v) ? ' on' : ''}" data-act="${act}" data-key="${key}" data-val="${esc(v)}" ${extra}>${esc(v)}</button>`).join('')}</div>`;
}
function seg(act, key, options, current, fmt = (v) => v, extra = '') {
  return `<div class="seg">${options.map((v) => `<button class="${current === v ? 'on' : ''}" data-act="${act}" data-key="${key}" data-val="${v}" ${extra}>${fmt(v)}</button>`).join('')}</div>`;
}

// multi-select chips for bucketed filters; values are stored as strings
function multi(key, opts, selected) {
  return `<div class="picks">${opts.map(([v, label]) => `<button class="pick${selected.includes(String(v)) ? ' on' : ''}" data-act="f-pick" data-key="${key}" data-val="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}

function prefsForm(p) {
  const pr = state.partners[p];
  const d = `data-p="${p}"`;
  return `
    <div class="group">
      <div class="label">Where do you work?</div>
      ${seg('pref-seg', 'work', Object.keys(WORK_HUBS), pr.work, (k) => esc(WORK_HUBS[k].name), d)}
    </div>
    ${pr.work !== 'remote' ? `<div class="group">
      <div class="label">Longest commute you'd accept</div>
      ${seg('pref-seg', 'maxCommute', [0, 20, 30, 45, 60], pr.maxCommute, (v) => (v ? `${v} min` : 'Any'), d)}
    </div>` : ''}
    <div class="group">
      <div class="label">Dealbreakers <span class="hint-inline">must have, or the home is hidden</span></div>
      ${picks('pref-pick', 'dealbreakers', Object.keys(DEALBREAKERS), pr.dealbreakers, d)}
    </div>
    <div class="group">
      <div class="label">Nice to have <span class="hint-inline">used for your fit score</span></div>
      ${picks('pref-pick', 'nice', FEATURES, pr.nice, d)}
    </div>`;
}

function filtersForm() {
  const f = state.filters;
  const { lo, hi } = priceBounds();
  const min = f.minPrice || lo;
  const max = f.maxPrice || hi;
  const count = pool().length;
  return `
    <p class="fine pick-note">Pick as many as you like in each question. Leave one blank for any.</p>
    <div class="group">
      <div class="label">Price</div>
      <div class="range-vals"><b id="minLbl">${shortMoney(min)}</b><span>to</span><b id="maxLbl">${shortMoney(max)}${max >= hi ? '+' : ''}</b></div>
      <div class="dual">
        <input type="range" min="${lo}" max="${hi}" step="25000" value="${min}" data-act="f-range" data-key="minPrice" aria-label="Minimum price">
        <input type="range" min="${lo}" max="${hi}" step="25000" value="${max}" data-act="f-range" data-key="maxPrice" aria-label="Maximum price">
      </div>
    </div>
    <div class="group">
      <div class="label">Monthly payment <span class="hint-inline">${state.finance.down}% down · ${state.finance.rate}% rate</span></div>
      ${multi('monthly', MONTHLY_BUCKETS, f.monthly)}
    </div>
    <div class="two">
      <div class="group"><div class="label">Beds</div>${multi('beds', BED_OPTS, f.beds)}</div>
      <div class="group"><div class="label">Baths</div>${multi('baths', BATH_OPTS, f.baths)}</div>
    </div>
    <div class="group"><div class="label">Size <span class="hint-inline">sqft</span></div>${multi('sizes', SIZE_BUCKETS, f.sizes)}</div>
    <div class="group"><div class="label">Style</div>${picks('f-pick', 'styles', styleOptions(), f.styles)}</div>
    <div class="group"><div class="label">Towns <span class="hint-inline">you'll swipe one town at a time</span></div>${picks('f-pick', 'hoods', hoodOptions(), f.hoods)}</div>
    <div class="group"><div class="label">HOA</div>${multi('hoa', HOA_OPTS, f.hoa)}</div>
    <label class="toggle"><input type="checkbox" data-act="f-flood" ${f.hideHighFlood ? 'checked' : ''}><span>Hide homes in high flood-risk zones</span></label>
    <div class="poolcount ${count ? '' : 'zero'}" id="poolCount">${poolCountText(count)}</div>`;
}
function poolCountText(count) {
  const hidden = listings().filter((l) => passesFilters(l) && !inPool(l)).length;
  if (!count) return `${icon('info')}<span>No homes match. Try widening your price or removing a filter.</span>`;
  return `${icon('home')}<span><b>${count}</b> home${count === 1 ? '' : 's'} to swipe${hidden ? ` · ${hidden} hidden by dealbreakers` : ''}</span>`;
}

// ---------- discover (swipe) ----------
// "Where do you want to start?" Each town is a short deck of its own.
function townPicker(inSheet = false) {
  const p = state.active;
  const towns = townOptions();
  const cur = currentTown();
  const card = (t) => {
    const left = p === 'a' ? t.leftA : t.leftB;
    const done = !t.leftA && !t.leftB;
    const hood = HOODS.find((h) => h.name === t.name);
    return `<button class="town${t.name === cur ? ' on' : ''}${done ? ' done' : ''}" data-act="town" data-val="${esc(t.name)}">
      <div class="town-photo">${photoTag(t.homes[0], 0)}</div>
      <div class="town-body">
        <b>${esc(t.name)}</b>
        <span class="muted">${done ? `Done · ${t.matched} match${t.matched === 1 ? '' : 'es'}` : `${left} home${left === 1 ? '' : 's'} for ${nm(p)}${hood ? ` · schools ${hood.school}/10` : ''}`}</span>
      </div>
      ${t.name === cur ? `<span class="town-tag">Now</span>` : ''}
    </button>`;
  };
  return `${inSheet ? `<div class="sheet-head"><h2>Switch town</h2><button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>` : `
    <div class="eyebrow">Discover</div>
    <h1 class="town-h">Where do you want to start?</h1>
    <p class="muted town-lede">Pick one town. You'll both swipe just its homes, then move on to the next, so it never turns into endless scrolling.</p>`}
    <div class="town-grid">${towns.map(card).join('')}</div>
    <button class="link" data-act="sheet" data-name="filters">Change which towns are on the list</button>`;
}

function renderSwipe() {
  const p = state.active;
  if (pool().length && !currentTown()) return `<div class="swipe-layout"><section class="deck-col town-col">${townPicker()}</section></div>`;
  const deck = deckFor(p);
  const total = townPool().length;
  const town = currentTown();
  const head = `<div class="deck-head">
      <div class="deck-meta">${town ? `<button class="town-chip" data-act="sheet" data-name="town">${icon('pin')}${esc(town)}${icon('chev')}</button>` : '<div class="eyebrow">Discover</div>'}
        <div class="deck-count">${!total ? 'No homes fit yet' : deck.length ? `${deck.length} of ${total} left for ${nm(p)}` : `All caught up, ${nm(p)}`}</div></div>
      <button class="pill-btn" data-act="sheet" data-name="filters">${icon('sliders')}Filters${activeFilterCount() ? ` · ${activeFilterCount()}` : ''}</button>
    </div>`;

  if (!total) {
    return `<div class="swipe-layout"><section class="deck-col">${head}
      <div class="empty">
        <div class="empty-ic">${icon('sliders')}</div>
        <h2>No homes fit right now</h2>
        <p>Your filters and dealbreakers rule out every home. Try a wider price range or fewer must-haves.</p>
        <button class="btn primary" data-act="sheet" data-name="filters">Edit filters</button>
        <button class="btn ghost" data-act="sheet" data-name="prefs">Edit dealbreakers</button>
      </div></section></div>`;
  }
  if (!deck.length) {
    const left = deckFor(other(p)).length;
    const passes = townPool().filter((l) => state.swipes[p][l.id] === 'pass').length;
    const here = townPool().filter((l) => isLike(state.swipes.a[l.id]) && isLike(state.swipes.b[l.id])).length;
    const nextTowns = townOptions().filter((t) => t.name !== town && (t.leftA || t.leftB));
    return `<div class="swipe-layout"><section class="deck-col">${head}
      <div class="empty">
        <div class="empty-ic">${icon('check')}</div>
        <h2>${left ? `You've seen every home in ${esc(town)}` : `${esc(town)} is done!`}</h2>
        <p>${left ? `${nm(other(p))} still has ${left} to go here.` : `You found ${here} match${here === 1 ? '' : 'es'} in ${esc(town)}.${nextTowns.length ? ' Where to next?' : " That's every town on your list."}`}</p>
        ${left ? `<button class="btn primary" data-act="switch">Hand off to ${nm(other(p))}</button>`
          : nextTowns.length ? `<div class="next-towns">${nextTowns.slice(0, 4).map((t) => `<button class="btn ${t === nextTowns[0] ? 'primary' : 'ghost'}" data-act="town" data-val="${esc(t.name)}">${icon('pin')}${esc(t.name)} · ${p === 'a' ? t.leftA : t.leftB}</button>`).join('')}</div>`
          : `<button class="btn primary" data-act="view" data-view="matches">See your matches</button>`}
        ${!left && nextTowns.length > 4 ? '<button class="link" data-act="sheet" data-name="town">See all towns</button>' : ''}
        ${!left && nextTowns.length && matches().length ? '<button class="btn ghost" data-act="view" data-view="matches">See your matches</button>' : ''}
        ${passes ? `<button class="btn ghost" data-act="review-passes">Give my ${passes} pass${passes === 1 ? '' : 'es'} another look</button>` : ''}
        ${left || !nextTowns.length ? '<button class="btn ghost" data-act="sheet" data-name="filters">Widen filters</button>' : ''}
        ${canUndo() ? `<button class="link" data-act="undo">Undo last swipe</button>` : ''}
      </div></section></div>`;
  }

  const [top, next] = deck;
  return `<div class="swipe-layout">
    <section class="deck-col">
      ${head}
      <div class="deck">
        ${next ? cardHTML(next, true) : ''}
        ${cardHTML(top, false)}
      </div>
      ${whyNot && whyNot.p === p ? whyNotBar() : suggestBar && suggestBar.p === p ? suggestHTML() : ''}
      <div class="actions">
        <button class="round sm" data-act="undo" aria-label="Undo" ${canUndo() ? '' : 'disabled'}>${icon('undo')}</button>
        <button class="round lg pass" data-act="pass" aria-label="Pass">${icon('x')}</button>
        <button class="round md love" data-act="love" aria-label="Love it">${icon('star')}</button>
        <button class="round lg like" data-act="like" aria-label="Like">${icon('heart')}</button>
        <button class="round sm" data-act="details" data-id="${top.id}" aria-label="Details">${icon('info')}</button>
      </div>
      <p class="kbd-hint">← pass · ↑ love · → like · click the photo for full details</p>
    </section>
  </div>`;
}

function activeFilterCount() {
  const f = state.filters;
  const { lo, hi } = priceBounds();
  return [f.minPrice > lo, f.maxPrice && f.maxPrice < hi, f.monthly.length, f.beds.length, f.baths.length, f.sizes.length,
    f.styles.length, f.hoods.length, f.hoa.length, f.hideHighFlood].filter(Boolean).length;
}

function cardHTML(l, behind) {
  const pay = payment(l);
  const cut = l.originalPrice > l.price;
  // the card is just the photo and the headline numbers; tapping it opens everything else
  return `<article class="card${behind ? ' behind' : ''}" data-id="${l.id}">
    <div class="photo">
      ${photoTag(l, 0)}
      <div class="badges">
        ${l.dom != null && l.dom <= 7 ? `<span class="badge-pill new">New · ${l.dom}d</span>` : ''}
        ${cut ? `<span class="badge-pill cut">${icon('tag')}Price cut ${shortMoney(l.originalPrice - l.price)}</span>` : ''}
        ${l.placeholderPhoto ? '<span class="badge-pill">Placeholder photo</span>' : ''}
      </div>
      <span class="stamp like">LIKE</span><span class="stamp nope">NOPE</span><span class="stamp love">LOVE</span>
      <div class="photo-fade"></div>
      <div class="photo-text">
        ${vibe(l) ? `<div class="vibe">${icon('sparkle')}${vibe(l)}</div>` : ''}
        <div class="price">${money(l.price)}<span class="est">${money(pay.total)}/mo est.</span></div>
        <div class="addr">${esc(l.address)} · ${esc(l.hood)}</div>
        <div class="photo-facts"><span><b>${l.beds}</b> bd</span><span><b>${l.baths}</b> ba</span><span><b>${num(l.sqft)}</b> sqft</span>
          <span class="tap-hint">${icon('info')}Tap for details${l.photos.length > 1 ? ` · ${l.photos.length} photos` : ''}</span></div>
      </div>
    </div>
  </article>`;
}

function whyNotBar() {
  const opts = [['price', 'Price'], ['size', 'Too small'], ['location', 'Location'], ['style', 'Style'], ['condition', 'Age / condition']];
  return `<div class="whynot"><span>Why not?</span>${opts.map(([k, label]) =>
    `<button data-act="why" data-val="${k}">${label}</button>`).join('')}<button class="skip" data-act="why-skip" aria-label="Skip">${icon('x')}</button></div>`;
}

function attachDrag(card) {
  let sx = 0; let sy = 0; let dx = 0; let dy = 0; let t0 = 0; let dragging = false; let moved = false;
  card.addEventListener('pointerdown', (e) => {
    if (animating || e.button !== 0) return;
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; t0 = performance.now();
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
    const up = Math.max(0, Math.min(1, -dy / 110)) * (Math.abs(dx) < 70 ? 1 : 0);
    card.style.setProperty('--like', up ? 0 : Math.max(0, Math.min(1, dx / 100)));
    card.style.setProperty('--nope', up ? 0 : Math.max(0, Math.min(1, -dx / 100)));
    card.style.setProperty('--love', up);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    card.style.transition = '';
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t0); // px per ms
    const sideways = Math.abs(dx) > Math.abs(dy) * 0.8;
    const far = Math.abs(dx) > 110 || (Math.abs(dx) > 50 && speed > 0.6);
    if (moved && dy < -120 && Math.abs(dx) < 90) return swipe('love');
    if (moved && sideways && far) return swipe(dx > 0 ? 'like' : 'pass');
    card.style.transform = '';
    ['--like', '--nope', '--love'].forEach((v) => card.style.setProperty(v, 0));
    if (moved) return;
    // a tap anywhere on the card opens the full details popup
    openSheet('details', card.dataset.id);
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', () => { dragging = false; card.style.transition = ''; card.style.transform = ''; });
}

function swipe(dir) {
  const card = $('.card:not(.behind)');
  if (!card || animating) return;
  animating = true;
  const id = card.dataset.id;
  const off = { like: 'translate(140%, 30px) rotate(22deg)', pass: 'translate(-140%, 30px) rotate(-22deg)', love: 'translate(0, -130%) rotate(0deg)' }[dir];
  card.style.transition = 'transform .32s ease';
  card.style.setProperty(dir === 'pass' ? '--nope' : dir === 'love' ? '--love' : '--like', 1);
  card.style.transform = off;
  const p = state.active;
  suggestBar = null;
  // undo works on the swipe in flight too (it's queued), so enable it now
  document.querySelectorAll('.actions [data-act="undo"]').forEach((b) => { b.disabled = false; });
  setTimeout(() => {
    animating = false;
    state.swipes[p][id] = dir;
    state.lastSwipe = { p, id };
    whyNot = dir === 'pass' ? { id, p } : null;
    save();
    render();
    if (undoQueued) { undoQueued = false; return undo(); }
    if (isLike(dir) && isLike(state.swipes[other(p)][id])) return showMatch(id);
    const n = Object.keys(state.swipes[p]).length;
    if (n % 10 === 0) {
      const liked = Object.values(state.swipes[p]).filter(isLike).length;
      const left = deckFor(other(p)).length;
      toast(`<b>${MILESTONE_LINES[(n / 10 - 1) % MILESTONE_LINES.length]}</b> ${n} homes swiped, ${liked} liked.`,
        left ? { act: 'switch', label: `${nm(other(p))}'s turn` } : null);
    }
  }, 300);
}

const canUndo = () => state.lastSwipe && state.lastSwipe.p === state.active && byId(state.lastSwipe.id);
let undoQueued = false; // undo tapped while a swipe is still animating; applied once it lands
function undo() {
  if (animating) { undoQueued = true; return; }
  if (!canUndo()) return;
  suggestBar = null;
  // the swipe being undone may be from another town; go back there so the card reappears
  const last = byId(state.lastSwipe.id);
  if (last && last.hood !== currentTown() && pool().some((l) => l.id === last.id)) state.town = last.hood;
  if (state.lastReason && state.lastReason.id === state.lastSwipe.id && state.lastReason.p === state.active) {
    const r = state.reasons[state.lastReason.p];
    r[state.lastReason.reason] = Math.max(0, (r[state.lastReason.reason] || 0) - 1);
    state.lastReason = null;
  }
  delete state.swipes[state.active][state.lastSwipe.id];
  state.lastSwipe = null;
  whyNot = null;
  save();
  render();
}

function recordWhy(reason) {
  const p = whyNot.p;
  const r = state.reasons[p];
  r[reason] = (r[reason] || 0) + 1;
  state.lastReason = { p, id: whyNot.id, reason };
  whyNot = null;
  save();
  render();
  if (r[reason] % 3 !== 0) return toast('Got it. We\'ll use that to tune your feed.');
  const f = state.filters;
  const { lo, hi } = priceBounds();
  const suggestions = {
    price: () => {
      const cur = f.maxPrice || hi;
      const next = Math.max(f.minPrice || lo, cur - 50000);
      suggest(`You've passed on price ${r[reason]} times. Lower the max to ${shortMoney(next)} for both of you?`, { act: 'apply-suggest', label: 'Apply', data: `data-key="maxPrice" data-val="${next}"` });
    },
    size: () => {
      // offer the next size step up, but only if it actually trims the deck and leaves homes
      const sq = townPool().map((l) => l.sqft);
      const next = SIZE_BUCKETS.map(([b]) => b).find((b) => b > Math.min(...sq) && sq.some((v) => v >= b));
      if (!next) return toast('Got it. We\'ll use that to tune your feed.');
      suggest(`Homes keep feeling too small. Only show ${num(next)}+ sqft?`, { act: 'apply-suggest', label: 'Apply', data: `data-key="sizes" data-val="${next}"` });
    },
    location: () => suggest('Location keeps coming up. Narrow your neighborhoods?', { act: 'sheet', label: 'Edit', data: 'data-name="filters"' }),
    style: () => suggest('Not loving the styles? Pick the ones you both like.', { act: 'sheet', label: 'Edit', data: 'data-name="filters"' }),
    condition: () => suggest('Want to skip older homes? Add "Built 2000+" as a dealbreaker.', { act: 'sheet', label: 'Edit', data: 'data-name="prefs"' }),
  };
  suggestions[reason]();
}

function showMatch(id) {
  clickShield = 0; // the match screen's own buttons should work right away
  openSheet('match', id);
  confetti();
}
function matchSheet(id) {
  const l = byId(id);
  return `<div class="match">
    <div class="match-photo">${photoTag(l, 0)}<div class="match-avatars"><span class="avatar a">${nm('a').charAt(0)}</span>${icon('heart', 'mh')}<span class="avatar b">${nm('b').charAt(0)}</span></div></div>
    <div class="match-title">${MATCH_TITLES[(matches().length - 1) % MATCH_TITLES.length]}</div>
    <p>${nm('a')} and ${nm('b')} both like <b>${esc(l.address)}</b>.</p>
    <p class="muted">${money(l.price)} · ${l.beds} bd · ${l.baths} ba · ${esc(l.hood)}</p>
    <div class="two"><button class="btn ghost" data-act="close">Keep swiping</button>
    <button class="btn primary" data-act="goto" data-view="matches">View matches</button></div>
  </div>`;
}

// ---------- details ----------
function detailsHTML(l, inline = false) {
  const pay = payment(l);
  const a = state.swipes.a[l.id];
  const b = state.swipes.b[l.id];
  const cut = l.originalPrice > l.price;
  const onDeck = !inline && state.view === 'swipe' && (deckFor(state.active)[0] || {}).id === l.id;
  // votes stay hidden until both partners have swiped, so nobody is swayed
  const votes = a && b ? `<div class="votes">${voteTag('a', a)}${voteTag('b', b)}</div>` : '';
  const row = (label, value) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
  const commuteRow = (p) => {
    const c = commute(l, p);
    const hub = WORK_HUBS[state.partners[p].work];
    return `<div class="commute"><span class="avatar ${p} sm">${nm(p).charAt(0)}</span><span>${nm(p)}</span><b>${c == null ? (hub && hub.lat == null ? 'Works from home' : '—') : `${c} min`}</b><span class="muted">${hub && hub.lat != null ? `to ${esc(hub.name)}` : ''}</span></div>`;
  };
  const fits = ['a', 'b'].map((p) => {
    const f = fit(l, p);
    return f ? `<div class="kv"><span>${nm(p)}'s nice-to-haves</span><b>${f.hits.length}/${f.total}</b></div>` : '';
  }).join('');

  return `<div class="details${inline ? ' inline' : ''}">
    ${inline ? '' : `<button class="icon-btn close" data-act="close" aria-label="Close">${icon('x')}</button>`}
    <div class="gallery">${l.photos.map((_, i) => photoTag(l, i)).join('')}</div>
    ${l.photos.length > 1 ? `<div class="gallery-hint">${l.photos.length} photos · scroll →</div>` : ''}
    <div class="d-head">
      <div>
        <div class="d-price">${money(l.price)}${cut ? `<span class="was">${money(l.originalPrice)}</span>` : ''}</div>
        <div class="d-addr">${esc(l.address)}, ${esc(l.city)}, ${esc(l.state)} ${esc(l.zip || '')}</div>
      </div>
      ${votes}
    </div>
    <div class="facts-row big">
      <span>${icon('bed')}<b>${l.beds}</b> beds</span><span>${icon('bath')}<b>${l.baths}</b> baths</span>
      <span>${icon('area')}<b>${num(l.sqft)}</b> sqft</span>
    </div>
    ${chipsFor(l, state.active) ? `<div class="chips d-chips">${chipsFor(l, state.active)}</div>` : ''}

    ${isLike(a) && isLike(b) ? `<section class="d-sec">${reactionRow(l)}</section>` : ''}
    <section class="d-sec">
      <h3>Monthly cost</h3>
      <div class="pay-total"><b>${money(pay.total)}</b><span>/mo estimated</span></div>
      <div class="pay-bar">
        <i style="flex:${pay.pi}" class="c1"></i><i style="flex:${pay.tax}" class="c2"></i><i style="flex:${pay.ins + pay.pmi}" class="c3"></i>${pay.hoa ? `<i style="flex:${pay.hoa}" class="c4"></i>` : ''}
      </div>
      <div class="pay-legend">
        <span><i class="c1"></i>Principal & interest ${money(pay.pi)}</span>
        <span><i class="c2"></i>Property tax ${money(pay.tax)}</span>
        <span><i class="c3"></i>Insurance${pay.pmi ? ' & PMI' : ''} ${money(pay.ins + pay.pmi)}</span>
        ${pay.hoa ? `<span><i class="c4"></i>HOA ${money(pay.hoa)}</span>` : ''}
      </div>
      <div class="pay-controls">
        <div><div class="label">Down payment</div>${seg('fin', 'down', [3.5, 5, 10, 20], state.finance.down, (v) => `${v}%`)}</div>
        <div><div class="label">Rate</div>${seg('fin', 'rate', [5.5, 6, 6.5, 7], state.finance.rate, (v) => `${v}%`)}</div>
      </div>
      <p class="fine">Estimate only: 30-year fixed, ${money(l.price * (state.finance.down / 100))} down, insurance at 0.5% of price${pay.pmi ? ', PMI under 20% down' : ''}.</p>
    </section>

    <section class="d-sec">
      <h3>Commutes</h3>
      ${commuteRow('a')}${commuteRow('b')}
    </section>

    <section class="d-sec">
      <h3>About this home</h3>
      <p>${esc(l.description)}</p>
      ${l.features.length ? `<div class="feature-list">${l.features.map((f) => `<span>${icon('check')}${esc(f)}</span>`).join('')}</div>` : ''}
    </section>

    <section class="d-sec grid2">
      ${row('Style', esc(l.style))}
      ${row('Year built', l.year || '—')}
      ${row('Lot', l.lotSqft ? `${num(l.lotSqft)} sqft` : '—')}
      ${row('Garage', l.garage ? `${l.garage} car` : '—')}
      ${row('HOA', l.hoa ? `${money(l.hoa)}/mo` : 'None')}
      ${row('Price / sqft', l.sqft ? money(l.price / l.sqft) : '—')}
      ${row('Schools', l.school ? `${l.school}/10` : '—')}
      ${row('Flood risk', l.flood ? `<span class="flood ${l.flood.toLowerCase()}">${l.flood}</span>` : '—')}
      ${row('On market', l.dom != null ? `${l.dom} days` : '—')}
      ${fits}
    </section>

    ${l.lat != null ? `<section class="d-sec"><h3>Location</h3><div class="map small" data-map="one" data-id="${l.id}"></div></section>` : ''}
    <p class="fine listed">Listed by ${esc(l.office)}.${l.source === 'sample' ? ' Sample listing for demo purposes; not a real home for sale.' : ''}${l.placeholderPhoto ? ' Photo is a placeholder.' : ''}</p>
    ${onDeck ? `<div class="d-actions">
      <button class="btn ghost" data-act="sheet-swipe" data-val="pass">${icon('x')}Pass</button>
      <button class="btn ghost love" data-act="sheet-swipe" data-val="love">${icon('star')}Love</button>
      <button class="btn primary" data-act="sheet-swipe" data-val="like">${icon('heart')}Like</button>
    </div>` : ''}
  </div>`;
}
const voteTag = (p, v) => `<span class="vote ${isLike(v) ? 'yes' : 'no'}"><span class="avatar ${p} sm">${nm(p).charAt(0)}</span>${v === 'love' ? icon('star') : isLike(v) ? icon('heart') : icon('x')}</span>`;

// ---------- matches ----------
function renderMatches() {
  const m = sortMatches(matches());
  const al = almosts();
  const mode = state.matchesMode;
  let html = `<div class="page-head">
    <div><div class="eyebrow">Matches</div><h1>${m.length ? `${m.length} home${m.length === 1 ? '' : 's'} you both like` : 'No matches yet'}</h1></div>
    ${m.length >= 2 ? `<button class="btn primary small" data-act="view" data-view="final">${icon('trophy')}Final Round</button>` : ''}
  </div>`;

  if (!m.length) {
    html += `<div class="empty-card">${icon('matches')}<p>A match happens when you both swipe right on the same home. Keep swiping, and pass the phone back and forth.</p>
      <button class="btn ghost" data-act="view" data-view="swipe">Go to Discover</button></div>`;
  } else {
    html += `<div class="toolbar">
      <div class="seg mode">
        <button class="${mode === 'list' ? 'on' : ''}" data-act="mmode" data-val="list">${icon('list')}List</button>
        <button class="${mode === 'map' ? 'on' : ''}" data-act="mmode" data-val="map">${icon('map')}Map</button>
        <button class="${mode === 'compare' ? 'on' : ''}" data-act="mmode" data-val="compare">${icon('columns')}Compare${state.compare.length ? ` (${state.compare.length})` : ''}</button>
      </div>
      ${mode === 'list' ? `<select data-act="msort" aria-label="Sort">
        ${[['fit', 'Best fit for you both'], ['price', 'Price: low to high'], ['monthly', 'Monthly: low to high'], ['commute', 'Shortest commutes'], ['size', 'Largest']].map(([v, t]) =>
          `<option value="${v}" ${state.matchSort === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>` : ''}
    </div>`;
    if (mode === 'list') {
      html += `<p class="fine" style="margin:0 0 10px">Tick up to 3 homes to compare them side by side.</p>
        <div class="grid">${m.map((l) => matchCard(l)).join('')}</div>`;
    } else if (mode === 'map') {
      html += `<div class="map big" data-map="matches"></div>
        <p class="fine">Red pins are matches. Gray pins are homes only one of you liked.</p>`;
    } else {
      html += renderCompare();
    }
  }

  if (al.length && mode !== 'compare') {
    html += `<div class="sec-title">Almost <span>only one of you liked these</span></div>
      <div class="list">${al.map((l) => {
        const passer = isLike(state.swipes.a[l.id]) ? 'b' : 'a';
        return `<div class="row-item">
          <div class="thumb" data-act="sheet" data-name="details" data-id="${l.id}">${photoTag(l, 0)}</div>
          <div class="ri-info" data-act="sheet" data-name="details" data-id="${l.id}">
            <b>${money(l.price)}</b><span>${l.beds} bd · ${l.baths} ba · ${esc(l.hood)}</span>
            <div class="votes">${voteTag('a', state.swipes.a[l.id])}${voteTag('b', state.swipes.b[l.id])}</div>
          </div>
          <button class="btn ghost small" data-act="second-look" data-id="${l.id}" data-p="${passer}">Ask ${nm(passer)} to rethink</button>
        </div>`;
      }).join('')}</div>`;
  }
  return html;
}

function bothFit(l) {
  const fa = fit(l, 'a');
  const fb = fit(l, 'b');
  const parts = [fa, fb].filter(Boolean);
  return parts.length ? Math.round(parts.reduce((s, f) => s + f.pct, 0) / parts.length) : null;
}
function avgCommute(l) {
  const cs = ['a', 'b'].map((p) => commute(l, p)).filter((c) => c != null);
  return cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
}
function sortMatches(m) {
  const key = {
    fit: (l) => -(bothFit(l) ?? 0) - (state.swipes.a[l.id] === 'love') * 10 - (state.swipes.b[l.id] === 'love') * 10,
    price: (l) => l.price,
    monthly: (l) => payment(l).total,
    commute: avgCommute,
    size: (l) => -l.sqft,
  }[state.matchSort];
  return [...m].sort((x, y) => key(x) - key(y));
}

function matchCard(l) {
  const on = state.compare.includes(l.id);
  const loves = ['a', 'b'].filter((p) => state.swipes[p][l.id] === 'love');
  const bf = bothFit(l);
  return `<article class="mcard${on ? ' selected' : ''}">
    <div class="mphoto" data-act="sheet" data-name="details" data-id="${l.id}">${photoTag(l, 0)}
      ${loves.length ? `<span class="badge-pill love">${icon('star')}${loves.map((p) => nm(p)).join(' & ')} loved it</span>` : ''}
    </div>
    <label class="cmp-check" title="Compare"><input type="checkbox" data-act="cmp" data-id="${l.id}" ${on ? 'checked' : ''}><span>${icon('check')}</span></label>
    <div class="mbody" data-act="sheet" data-name="details" data-id="${l.id}">
      <div class="mprice">${money(l.price)}<span>${money(payment(l).total)}/mo</span></div>
      <div class="mspecs">${l.beds} bd · ${l.baths} ba · ${num(l.sqft)} sqft</div>
      <div class="maddr">${esc(l.address)} · ${esc(l.hood)}</div>
      <div class="mmeta">${['a', 'b'].map((p) => { const c = commute(l, p); return c != null ? `<span><span class="avatar ${p} xs">${nm(p).charAt(0)}</span>${c} min</span>` : ''; }).join('')}
        ${Object.values(state.reactions[l.id] || {}).length ? `<span class="mini-react">${Object.values(state.reactions[l.id]).join('')}</span>` : ''}
        ${bf != null ? `<span class="fitpill">${bf}% fit</span>` : ''}</div>
    </div>
    <button class="remove" data-act="unmatch" data-id="${l.id}" aria-label="Remove from matches">${icon('x')}</button>
  </article>`;
}

function renderCompare() {
  const ids = state.compare.filter((id) => byId(id) && matches().some((l) => l.id === id));
  if (ids.length < 2) {
    return `<div class="empty-card">${icon('columns')}<p>Pick 2 or 3 homes in the List view to compare them side by side.</p>
      <button class="btn ghost" data-act="mmode" data-val="list">Choose homes</button></div>`;
  }
  const ls = ids.map(byId);
  // [label, value fn, display fn, "low" | "high" | null for which value is best]
  const rows = [
    ['Price', (l) => l.price, money, 'low'],
    ['Monthly', (l) => payment(l).total, money, 'low'],
    ['Beds', (l) => l.beds, (v) => v, 'high'],
    ['Baths', (l) => l.baths, (v) => v, 'high'],
    ['Size', (l) => l.sqft, (v) => `${num(v)} sqft`, 'high'],
    ['Price / sqft', (l) => l.price / (l.sqft || 1), money, 'low'],
    ['Lot', (l) => l.lotSqft || 0, (v) => (v ? `${num(v)} sqft` : '—'), 'high'],
    ['Year built', (l) => l.year || 0, (v) => v || '—', 'high'],
    ['HOA', (l) => l.hoa || 0, (v) => (v ? `${money(v)}/mo` : 'None'), 'low'],
    ['Schools', (l) => l.school || 0, (v) => (v ? `${v}/10` : '—'), 'high'],
    ['Flood risk', (l) => ({ Minimal: 0, Moderate: 1, High: 2 }[l.flood] ?? 3), (v) => ['Minimal', 'Moderate', 'High', '—'][v], 'low'],
    [`${nm('a')}'s commute`, (l) => commute(l, 'a') ?? 0, (v) => (v ? `${v} min` : '—'), 'low'],
    [`${nm('b')}'s commute`, (l) => commute(l, 'b') ?? 0, (v) => (v ? `${v} min` : '—'), 'low'],
    [`${nm('a')}'s fit`, (l) => fit(l, 'a')?.pct ?? -1, (v) => (v < 0 ? '—' : `${v}%`), 'high'],
    [`${nm('b')}'s fit`, (l) => fit(l, 'b')?.pct ?? -1, (v) => (v < 0 ? '—' : `${v}%`), 'high'],
  ];
  const allFeatures = [...new Set(ls.flatMap((l) => l.features))];
  return `<div class="compare" style="--cols:${ls.length}">
    <div class="c-row c-head"><div></div>${ls.map((l) => `<div class="c-home" data-act="sheet" data-name="details" data-id="${l.id}">${photoTag(l, 0)}<b>${esc(l.address)}</b><span>${esc(l.hood)}</span></div>`).join('')}</div>
    ${rows.map(([label, val, show, best]) => {
      const vals = ls.map(val);
      const valid = vals.filter((v) => v > 0 || (label === 'Flood risk' && v < 3));
      const target = best === 'low' ? Math.min(...valid) : Math.max(...valid);
      const distinct = new Set(vals).size > 1;
      return `<div class="c-row"><div class="c-label">${label}</div>${vals.map((v) => `<div class="${distinct && v === target ? 'best' : ''}">${show(v)}</div>`).join('')}</div>`;
    }).join('')}
    ${allFeatures.map((f) => `<div class="c-row"><div class="c-label">${esc(f)}</div>${ls.map((l) => `<div>${l.features.includes(f) ? icon('check', 'yes') : '<span class="muted">—</span>'}</div>`).join('')}</div>`).join('')}
    <p class="fine">Green marks the better value in each row.</p>
  </div>`;
}

// ---------- insights ----------
function renderInsights() {
  const L = listings();
  const both = L.filter((l) => state.swipes.a[l.id] && state.swipes.b[l.id]);
  const seenA = L.filter((l) => state.swipes.a[l.id]);
  const seenB = L.filter((l) => state.swipes.b[l.id]);
  const head = `<div class="page-head"><div><div class="eyebrow">Us</div><h1>How you two are lining up</h1></div></div>`;

  if (both.length < 5) {
    return `${head}<div class="empty-card">${icon('chart')}
      <p>Insights unlock once you've both swiped on at least 5 of the same homes. You're at ${both.length}.</p>
      <div class="progress-line"><i style="width:${Math.min(100, both.length * 20)}%"></i></div>
      <button class="btn ghost" data-act="view" data-view="swipe">Keep swiping</button></div>
      ${badgesHTML()}`;
  }

  const agree = both.filter((l) => isLike(state.swipes.a[l.id]) === isLike(state.swipes.b[l.id])).length;
  const score = Math.round((agree / both.length) * 100);
  const likeRate = (p, ls) => (ls.length ? ls.filter((l) => isLike(state.swipes[p][l.id])).length / ls.length : 0);
  const liked = (p) => L.filter((l) => isLike(state.swipes[p][l.id]));
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const top = (arr) => {
    const c = {};
    arr.forEach((v) => { c[v] = (c[v] || 0) + 1; });
    return Object.entries(c).sort((x, y) => y[1] - x[1])[0]?.[0];
  };

  const together = [];
  const apart = [];
  // features: compare how often each partner likes homes that have it
  FEATURES.forEach((f) => {
    const wa = seenA.filter((l) => l.features.includes(f));
    const wb = seenB.filter((l) => l.features.includes(f));
    if (wa.length < 3 || wb.length < 3) return;
    const ra = likeRate('a', wa);
    const rb = likeRate('b', wb);
    if (ra >= 0.6 && rb >= 0.6) together.push({ w: ra + rb, t: `<b>${esc(f)}</b>: you both said yes to most homes with it (${Math.round(ra * 100)}% and ${Math.round(rb * 100)}%).` });
    else if (Math.abs(ra - rb) >= 0.35) {
      const hi = ra > rb ? 'a' : 'b';
      apart.push({ w: Math.abs(ra - rb), t: `<b>${esc(f)}</b>: ${nm(hi)} likes ${Math.round(Math.max(ra, rb) * 100)}% of homes with it, ${nm(other(hi))} only ${Math.round(Math.min(ra, rb) * 100)}%.` });
    }
  });
  const pa = avg(liked('a').map((l) => l.price));
  const pb = avg(liked('b').map((l) => l.price));
  if (pa && pb) {
    if (Math.abs(pa - pb) >= 40000) {
      const hi = pa > pb ? 'a' : 'b';
      apart.push({ w: 1, t: `<b>Budget</b>: the homes ${nm(hi)} likes average ${shortMoney(Math.max(pa, pb))}, versus ${shortMoney(Math.min(pa, pb))} for ${nm(other(hi))}.` });
    } else together.push({ w: 1, t: `<b>Budget</b>: you're on the same page. You both like homes around ${shortMoney((pa + pb) / 2)}.` });
  }
  const ha = top(liked('a').map((l) => l.hood));
  const hb = top(liked('b').map((l) => l.hood));
  if (ha && hb) {
    if (ha === hb) together.push({ w: 0.9, t: `<b>Neighborhood</b>: ${esc(ha)} is a favorite for both of you.` });
    else apart.push({ w: 0.6, t: `<b>Neighborhood</b>: ${nm('a')} keeps liking ${esc(ha)}, while ${nm('b')} leans toward ${esc(hb)}.` });
  }
  const sa = top(liked('a').map((l) => l.style));
  const sb = top(liked('b').map((l) => l.style));
  if (sa && sb && sa !== sb) apart.push({ w: 0.5, t: `<b>Style</b>: ${nm('a')}'s favorite is ${esc(sa)}, ${nm('b')}'s is ${esc(sb)}.` });
  else if (sa && sb) together.push({ w: 0.5, t: `<b>Style</b>: you both gravitate to ${esc(sa)} homes.` });

  const reasonsLine = (p) => {
    const r = state.reasons[p];
    const k = Object.keys(r).sort((x, y) => r[y] - r[x])[0];
    const label = { price: 'price', size: 'size', location: 'location', style: 'style', condition: 'age or condition' }[k];
    return k ? `${nm(p)} passes most often because of <b>${label}</b>.` : '';
  };
  const reasons = [reasonsLine('a'), reasonsLine('b')].filter(Boolean);
  const verdict = !matches().length && score >= 75 ? 'You agree on what you don\'t want. Now find one you both like.' : score >= 75 ? 'You want the same things.' : score >= 50 ? 'Mostly aligned, with a few things to talk through.' : 'You see homes differently. That is normal, and worth talking about.';

  return `${head}
    <div class="score-card">
      <div class="ring" style="--p:${score}"><b>${score}%</b><span>in sync</span></div>
      <div><h2>${verdict}</h2><p class="muted">You agreed on ${agree} of the ${both.length} homes you've both swiped on, and you have ${matches().length} match${matches().length === 1 ? '' : 'es'}.</p>
        <div class="mini-stats"><span><span class="avatar a xs">${nm('a').charAt(0)}</span>likes ${Math.round(likeRate('a', seenA) * 100)}% of homes</span><span><span class="avatar b xs">${nm('b').charAt(0)}</span>likes ${Math.round(likeRate('b', seenB) * 100)}%</span></div>
      </div>
    </div>
    <div class="insight-cols">
      <div class="insight"><h3>${icon('heart')}Where you agree</h3>${together.length ? `<ul>${together.sort((x, y) => y.w - x.w).slice(0, 5).map((i) => `<li>${i.t}</li>`).join('')}</ul>` : '<p class="muted">Keep swiping to find out.</p>'}</div>
      <div class="insight differ"><h3>${icon('sparkle')}Worth talking about</h3>${apart.length ? `<ul>${apart.sort((x, y) => y.w - x.w).slice(0, 5).map((i) => `<li>${i.t}</li>`).join('')}</ul>` : '<p class="muted">No big differences so far.</p>'}</div>
    </div>
    ${personaHTML()}
    ${reasons.length ? `<div class="insight"><h3>${icon('info')}Why homes get passed</h3><ul>${reasons.map((r) => `<li>${r}</li>`).join('')}</ul></div>` : ''}
    ${badgesHTML()}`;
}

function personaHTML() {
  const pr = persona();
  if (!pr) return `<div class="persona locked"><div class="eyebrow">Your home personality</div><p class="muted">Get 3 matches to reveal what kind of homeowners you two are.</p></div>`;
  return `<div class="persona">
    <div class="eyebrow">Your home personality</div>
    <h2>${pr.name}</h2>
    <p>${pr.blurb}</p>
    <p class="fine">${Math.round(pr.pct * 100)}% of your ${pr.count} matches fit. Runner-up: ${pr.runnerUp.name}.</p>
  </div>`;
}

function badgesHTML() {
  const has = ([name, , , test]) => state.badges.includes(name) || test();
  const earned = BADGES.filter(has).length;
  return `<div class="sec-title">Badges <span>${earned} of ${BADGES.length} earned</span></div>
    <div class="badge-grid">${BADGES.map(([name, how, ico, test]) => {
      const on = has([name, how, ico, test]);
      return `<div class="badge-item${on ? ' earned' : ''}"><span class="b-ic">${icon(on ? ico : 'lock')}</span><b>${name}</b><span>${how}</span></div>`;
    }).join('')}</div>`;
}

// ---------- final round ----------
// final = { pool: [ids], votes: {a, b}, phase: 'a' | 'b' | 'reveal', out: [ids] }
function startFinal() {
  const ids = sortMatches(matches()).map((l) => l.id).slice(0, 8);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  state.final = { pool: ids, votes: { a: null, b: null }, phase: 'a', out: [], seen: matches().map((l) => l.id) };
  state.active = 'a';
  state.winner = null;
  save();
  render();
}

function renderFinal() {
  if (state.winner && byId(state.winner)) return renderWinner();
  const m = matches();
  const f = state.final;
  if (!f || f.pool.some((id) => !byId(id))) {
    return `<div class="page-head"><div><div class="eyebrow">Final Round</div><h1>Narrow it down to one</h1></div></div>
      <div class="how">
        <div><b>1</b><span>Your top matches face off, two at a time.</span></div>
        <div><b>2</b><span>You each pick a favorite in secret.</span></div>
        <div><b>3</b><span>Agree, and the other home is out. Disagree, and you talk it over.</span></div>
      </div>
      ${m.length >= 2
        ? `<button class="btn primary" data-act="final-start">Start with your top ${Math.min(8, m.length)} matches</button>`
        : `<div class="empty-card">${icon('trophy')}<p>You need at least 2 matches. You have ${m.length}.</p><button class="btn ghost" data-act="view" data-view="swipe">Keep swiping</button></div>`}`;
  }

  const [x, y] = f.pool.slice(0, 2).map(byId);
  const total = f.pool.length + f.out.length;
  let head;
  let foot = '';
  const pickable = f.phase !== 'reveal';

  if (pickable) {
    head = `<h2><span class="avatar ${f.phase}">${nm(f.phase).charAt(0)}</span>${nm(f.phase)}, which would you rather live in?</h2>
      <p class="muted">${f.phase === 'a' ? `${nm('b')} votes next, without seeing your pick.` : `${nm('a')} has voted. You'll see their pick after you choose.`}</p>`;
  } else if (f.votes.a === f.votes.b) {
    const loser = f.votes.a === x.id ? y : x;
    head = `<h2>${icon('check', 'ok')} You agree</h2><p class="muted">${esc(byId(f.votes.a).address)} moves on. ${esc(loser.address)} is out.</p>`;
    foot = `<button class="btn primary" data-act="final-next">${f.pool.length === 2 ? 'Reveal your home' : 'Next matchup'}</button>`;
  } else {
    head = `<h2>Split decision</h2><p class="muted">${nm('a')} picked ${esc(byId(f.votes.a).address)}, ${nm('b')} picked ${esc(byId(f.votes.b).address)}.</p>`;
    foot = `<div class="talk">
      <h3>Talk it over</h3>
      <p class="muted">Each of you name the one thing you love most about your pick. Tap a home to see the full side-by-side.</p>
      <div class="two"><button class="btn primary" data-act="final-revote">Vote again</button>
      ${f.pool.length > 2 ? '<button class="btn ghost" data-act="final-keep">Keep both for now</button>'
        : '<button class="btn ghost" data-act="coin">Flip a coin</button>'}</div>
      ${f.pool.length === 2 ? '<button class="link" data-act="sheet" data-name="agent" data-id="both">Still stuck? Tour both in person</button>' : ''}
    </div>`;
  }

  const vcard = (l) => {
    let cls = '';
    if (!pickable) {
      if (f.votes.a === f.votes.b && f.votes.a !== l.id) cls = ' out';
      else if (f.votes.a === l.id || f.votes.b === l.id) cls = ' picked';
    }
    const who = !pickable ? ['a', 'b'].filter((p) => f.votes[p] === l.id).map((p) => `<span class="avatar ${p} sm">${nm(p).charAt(0)}</span>`).join('') : '';
    const pay = payment(l);
    return `<button class="vcard${cls}" data-act="${pickable ? 'final-vote' : 'sheet'}" data-name="details" data-id="${l.id}">
      <div class="vphoto">${photoTag(l, 0)}${who ? `<div class="who-picked">${who}</div>` : ''}</div>
      <div class="vbody">
        <div class="vprice">${money(l.price)}</div>
        <div class="muted">${esc(l.address)} · ${esc(l.hood)}</div>
        <ul>
          <li>${l.beds} bd · ${l.baths} ba · ${num(l.sqft)} sqft</li>
          <li>${money(pay.total)}/mo est.</li>
          ${['a', 'b'].map((p) => { const c = commute(l, p); return c != null ? `<li>${nm(p)}: ${c} min commute</li>` : ''; }).join('')}
          ${l.features.slice(0, 2).map((t) => `<li>${esc(t)}</li>`).join('')}
        </ul>
      </div></button>`;
  };

  const inRound = new Set([...f.pool, ...f.out, ...(f.seen || [])]);
  const newer = m.filter((l) => !inRound.has(l.id)).length;
  return `${newer ? `<div class="poolcount" style="margin-bottom:12px">${icon('sparkle')}<span>${newer} new match${newer === 1 ? '' : 'es'} since you started. <button class="link" data-act="final-start">Restart to include ${newer === 1 ? 'it' : 'them'}</button></span></div>` : ''}
    <div class="page-head"><div><div class="eyebrow">Final Round · ${f.pool.length} of ${total} still in</div>${head}</div>
      <button class="link" data-act="final-restart">Restart</button></div>
    <div class="dots">${f.pool.map(() => '<i></i>').join('')}${f.out.map(() => '<i class="gone"></i>').join('')}</div>
    <div class="versus">${vcard(x)}<div class="vs">VS</div>${vcard(y)}</div>
    ${foot}`;
}

let voteLock = 0;
function finalVote(id) {
  const f = state.final;
  if (Date.now() < voteLock || f.phase === 'reveal') return;
  voteLock = Date.now() + 400;
  f.votes[f.phase] = id;
  if (f.phase === 'a') {
    f.phase = 'b';
    state.active = 'b';
    save();
    render();
    openSheet('handoff-vote');
  } else {
    f.phase = 'reveal';
    save();
    countdown(() => {
      render();
      const cur = state.final;
      if (state.view === 'final' && cur === f && cur.phase === 'reveal' && cur.votes.a === cur.votes.b) confetti();
    });
  }
}

// 3-2-1 drumroll before the votes are shown
function countdown(done) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  openSheet('countdown');
  let n = 3;
  const tick = setInterval(() => {
    n -= 1;
    const el = $('#cd');
    if (n > 0 && el) { el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); return; }
    clearInterval(tick);
    if (sheet && sheet.name === 'countdown') closeSheet();
    done();
  }, 650);
}

function finalNext() {
  const f = state.final;
  const [x, y] = f.pool;
  const win = f.votes.a;
  const lose = win === x ? y : x;
  f.pool = f.pool.filter((id) => id !== x && id !== y);
  f.pool.push(win); // the winner goes to the back of the line to face someone new
  f.out.push(lose);
  f.votes = { a: null, b: null };
  f.phase = 'a';
  state.active = 'a';
  if (f.pool.length === 1) {
    state.winner = win;
    state.stats.finals += 1;
  }
  save();
  render();
  if (state.winner) confetti(true);
}

function renderWinner() {
  const l = byId(state.winner);
  const pay = payment(l);
  const sent = state.agentRequest && state.agentRequest.id === l.id;
  return `<div class="winner">
    <div class="w-photo">${photoTag(l, 0)}<div class="w-badge">${icon('trophy')}You found the one</div></div>
    <div class="w-body">
      <h1>${esc(l.address)}</h1>
      <p class="muted">${esc(l.hood)}${l.city !== l.hood ? `, ${esc(l.city)}` : ''} · ${nm('a')} & ${nm('b')} both picked it</p>
      <div class="w-stats">
        <div><b>${money(l.price)}</b><span>price</span></div>
        <div><b>${money(pay.total)}</b><span>per month</span></div>
        <div><b>${l.beds} / ${l.baths}</b><span>bd / ba</span></div>
        <div><b>${num(l.sqft)}</b><span>sqft</span></div>
      </div>
      <h3>Next steps</h3>
      <div class="steps-list">
        <button class="step" data-act="sheet" data-name="agent" data-id="${l.id}">${icon('calendar')}<span><b>${sent ? 'Tour requested' : 'Book a tour'}</b>${sent ? 'A local agent will reach out (demo)' : 'Get matched with a local buyer\'s agent'}</span>${icon('right')}</button>
        <button class="step" data-act="cta" data-msg="Demo: this is where a partner lender would show pre-approval options.">${icon('wallet')}<span><b>Get pre-approved</b>See what you can borrow, with no effect on your credit</span>${icon('right')}</button>
        <button class="step" data-act="share" data-id="${l.id}">${icon('share')}<span><b>Share with family</b>Copy a summary to send</span>${icon('right')}</button>
        <button class="step" data-act="sheet" data-name="details" data-id="${l.id}">${icon('info')}<span><b>Full details</b>Photos, costs, commutes and map</span>${icon('right')}</button>
      </div>
      <button class="link" data-act="final-restart">Run the Final Round again</button>
    </div>
  </div>`;
}

function agentSheet(id) {
  const homes = id === 'both' ? state.final.pool.slice(0, 2).map(byId) : [byId(id)];
  return `<div class="form-sheet">
    <div class="sheet-head"><h2>Book a tour</h2><button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <p class="muted">We'll connect you with a licensed local buyer's agent to tour ${homes.length > 1 ? 'both homes' : esc(homes[0].address)}.</p>
    <div class="tour-homes">${homes.map((l) => `<div>${photoTag(l, 0)}<span>${esc(l.address)}</span></div>`).join('')}</div>
    <label class="field"><span>Your name</span><input id="ag-name" type="text" autocomplete="name" value="${nm(state.active)}"></label>
    <label class="field"><span>Email</span><input id="ag-email" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <label class="field"><span>Phone</span><input id="ag-phone" type="tel" autocomplete="tel" placeholder="(555) 555-0123"></label>
    <div class="group"><div class="label">When works?</div>${seg('ag-when', 'when', ['This weekend', 'Weekday evening', 'Flexible'], 'This weekend')}</div>
    <label class="toggle consent"><input id="ag-consent" type="checkbox"><span>I agree that NestMatch may share my contact info and these homes with a licensed real estate agent, who may contact me by phone, text or email. You don't have to agree to this to buy a home; it's only needed to request a tour here.</span></label>
    <button class="btn primary" data-act="agent-submit" data-id="${homes[0].id}" data-ids="${homes.map((l) => l.id).join(',')}">Request tour</button>
    <p class="fine">Demo: nothing is sent anywhere.</p>
  </div>`;
}

// ---------- sheets (overlay) ----------
const SHEETS = {
  details: (id) => detailsHTML(byId(id)),
  town: () => townPicker(true),
  match: matchSheet,
  agent: agentSheet,
  filters: () => `<div class="sheet-head"><h2>Filters</h2><button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <p class="muted">Shared by both of you. Changes apply right away.</p>
    ${filtersForm()}
    <div class="two sticky-actions"><button class="btn ghost" data-act="f-clear">Clear all</button><button class="btn primary" data-act="close">Show ${pool().length} homes</button></div>`,
  prefs: () => prefsSheet(),
  handoff: () => `<div class="handoff">
    <div class="handoff-avatars"><span class="avatar ${state.active}">${nm(state.active).charAt(0)}</span>${icon('right')}<span class="avatar ${other(state.active)}">${nm(other(state.active)).charAt(0)}</span></div>
    <h2>Pass the device to ${nm(other(state.active))}</h2>
    <p class="muted">Swipes are private. You'll only see each other's picks on homes you've both swiped.</p>
    <button class="btn primary" data-act="confirm-switch">I'm ${nm(other(state.active))}</button>
    <button class="btn ghost" data-act="close">Cancel</button></div>`,
  countdown: () => `<div class="countdown"><p class="muted">Revealing your picks</p><b id="cd" class="pop">3</b><div class="cd-avatars"><span class="avatar a">${nm('a').charAt(0)}</span><span class="avatar b">${nm('b').charAt(0)}</span></div></div>`,
  'handoff-vote': () => `<div class="handoff">
    <div class="handoff-avatars"><span class="avatar a">${nm('a').charAt(0)}</span>${icon('lock')}<span class="avatar b">${nm('b').charAt(0)}</span></div>
    <h2>${nm('a')}'s vote is locked in</h2>
    <p class="muted">Hand the device to ${nm('b')}. ${nm('a')}'s pick stays hidden until ${nm('b')} votes.</p>
    <button class="btn primary" data-act="close">I'm ${nm('b')}, show me</button></div>`,
};
const CENTER_SHEETS = ['match', 'handoff', 'handoff-vote', 'countdown'];

function openSheet(name, arg) {
  if (name === 'prefs') prefsWho = state.active;
  sheet = { name, arg };
  drawSheet(false);
}
function drawSheet(keepScroll = true) {
  sheetMaps.splice(0).forEach((m) => m.remove());
  const o = $('#overlay');
  const prev = $('.sheet', o);
  const top = keepScroll && prev ? prev.scrollTop : 0;
  const center = CENTER_SHEETS.includes(sheet.name);
  o.innerHTML = `<div class="sheet ${center ? 'center' : ''} sheet-${sheet.name}" role="dialog" aria-modal="true">${SHEETS[sheet.name](sheet.arg)}</div>`;
  o.hidden = false;
  o.classList.toggle('centered', center);
  $('.sheet', o).scrollTop = top;
  mountMaps(o, sheetMaps);
}
function closeSheet() {
  sheetMaps.splice(0).forEach((m) => m.remove());
  sheet = null;
  const o = $('#overlay');
  o.hidden = true;
  o.innerHTML = '';
}
// re-render whatever is on screen after a state change, keeping scroll positions
function refresh() {
  save();
  if (sheet) drawSheet(true);
  render();
}

function prefsSheet() {
  const p = prefsWho || state.active;
  const live = state.source === 'live' && state.live;
  return `<div class="sheet-head"><h2>Preferences</h2><button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button></div>
    <div class="tabs-inline">${['a', 'b'].map((q) => `<button class="${q === p ? 'on' : ''}" data-act="prefs-who" data-val="${q}"><span class="avatar ${q} sm">${nm(q).charAt(0)}</span><span class="tab-name">${nm(q)}</span></button>`).join('')}</div>
    <label class="field"><span>Name</span><input type="text" maxlength="20" value="${nm(p)}" data-act="rename" data-p="${p}"></label>
    ${prefsForm(p)}
    <div class="poolcount">${poolCountText(pool().length)}</div>

    <h3 class="sheet-sec">Data source</h3>
    <div class="source-card">
      <div><b>${sourceLabel()}</b><span>${live ? `${state.live.listings.length} active listings · fetched ${new Date(state.live.fetchedAt).toLocaleDateString()}` : `${SAMPLE_LISTINGS.length} sample homes with photos`}</span></div>
      ${live ? '<button class="btn ghost small" data-act="use-sample">Use sample</button>' : ''}
    </div>
    <p class="muted small">Realtor.com, Zillow and Redfin don't allow other apps to pull their listings. For real listings, NestMatch connects through licensed data feeds instead.</p>
    ${serverLive === null ? `<p class="fine">Live listings need the NestMatch server. Run <code>node server.js</code> in the project folder.</p>`
      : serverLive === false ? `<p class="fine">To load real active listings (with no photos yet), add a free RentCast API key to <code>.env</code> as <code>RENTCAST_API_KEY=…</code> and restart the server.</p>`
      : `<div class="two live-form">
          <label class="field"><span>City</span><input id="lv-city" type="text" placeholder="Detroit" value="${esc(liveForm.city)}"></label>
          <label class="field"><span>State</span><input id="lv-state" type="text" maxlength="2" placeholder="MI" value="${esc(liveForm.state)}"></label>
        </div>
        <button class="btn ghost" data-act="load-live" ${liveForm.busy ? 'disabled' : ''}>${liveForm.busy ? 'Loading…' : 'Load live listings'}</button>
        <p class="fine">Live listings come from RentCast, with no photos yet (we show a placeholder). Full MLS photos need an IDX feed through a broker. Results are cached for 24 hours.</p>`}
    ${liveForm.error ? `<p class="error">${esc(liveForm.error)}</p>` : ''}

    ${window.NMGroups ? '<button class="btn ghost" data-g="change-mode">Change group (couple, family, solo)</button>' : ''}
    <button class="link danger" data-act="reset">Reset the whole demo</button>`;
}

async function loadLive() {
  liveForm.city = $('#lv-city').value.trim();
  liveForm.state = $('#lv-state').value.trim().toUpperCase();
  liveForm.busy = true;
  liveForm.error = '';
  drawSheet(true);
  try {
    const r = await fetch(`/api/listings?city=${encodeURIComponent(liveForm.city)}&state=${encodeURIComponent(liveForm.state)}`);
    const body = await r.json();
    if (!r.ok) throw new Error(body.message || 'Could not load listings.');
    const ls = (body.listings || []).filter((x) => x.price).map(mapRentcast);
    if (!ls.length) throw new Error('No active listings found for that city.');
    state.live = { city: liveForm.city, state: liveForm.state, fetchedAt: body.fetchedAt, listings: ls };
    state.source = 'live';
    state.filters = defaultFilters();
    state.final = null;
    state.winner = null;
    state.compare = [];
    toast(`Loaded ${ls.length} live listings in ${esc(liveForm.city)}`);
  } catch (e) {
    liveForm.error = e.message;
  }
  liveForm.busy = false;
  refresh();
}

// ---------- maps ----------
function mountMaps(root, registry) {
  if (!window.L) return;
  root.querySelectorAll('[data-map]').forEach((el) => {
    const tiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
    });
    const pin = (l, cls) => L.marker([l.lat, l.lng], {
      icon: L.divIcon({ className: '', html: `<div class="map-pin ${cls}">${shortMoney(l.price)}</div>`, iconSize: null }),
    });
    const map = L.map(el, { zoomControl: el.dataset.map !== 'one', scrollWheelZoom: el.dataset.map !== 'one', attributionControl: true });
    tiles().addTo(map);
    if (el.dataset.map === 'one') {
      const l = byId(el.dataset.id);
      map.setView([l.lat, l.lng], 13);
      pin(l, 'match').addTo(map);
      ['a', 'b'].forEach((p) => {
        const hub = WORK_HUBS[state.partners[p].work];
        if (hub && hub.lat != null) {
          L.marker([hub.lat, hub.lng], { icon: L.divIcon({ className: '', html: `<div class="map-hub ${p}">${nm(p).charAt(0)}</div>`, iconSize: null }) }).addTo(map);
        }
      });
    } else {
      const ms = matches();
      const al = almosts();
      const pts = [];
      al.forEach((l) => { if (l.lat != null) { pin(l, 'almost').on('click', () => openSheet('details', l.id)).addTo(map); pts.push([l.lat, l.lng]); } });
      ms.forEach((l) => { if (l.lat != null) { pin(l, 'match').on('click', () => openSheet('details', l.id)).addTo(map); pts.push([l.lat, l.lng]); } });
      if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
      else map.setView([29.76, -95.37], 10);
    }
    registry.push(map);
    setTimeout(() => { if (map.getContainer().isConnected) map.invalidateSize(); }, 60);
  });
}

// ---------- events ----------
// after a swipe from the details popup, swallow stray clicks briefly so a double-tap
// doesn't land on whatever was under the popup (like the tab bar)
let clickShield = 0;
document.addEventListener('click', (e) => {
  if (Date.now() < clickShield && !e.target.closest('[data-act="undo"]')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    if (e.target.id === 'overlay' && !(sheet && sheet.name === 'countdown')) closeSheet();
    return;
  }
  if (el.tagName === 'INPUT' && el.type !== 'checkbox') return;
  if (el.closest('.suggest')) suggestBar = null;
  const { act, id, key, val } = el.dataset;
  const f = state.filters;

  switch (act) {
    // onboarding
    case 'setup-names': {
      const na = $('#na').value.trim() || 'Partner 1';
      const nb = $('#nb').value.trim() || 'Partner 2';
      if (na.toLowerCase() === nb.toLowerCase()) { toast('Use two different names so you can tell whose turn it is'); break; }
      state.partners.a.name = na;
      state.partners.b.name = nb;
      state.setupStep = 1; save(); render(); break;
    }
    case 'setup-next': state.setupStep += 1; save(); render(); $('.main').scrollTop = 0; break;
    case 'setup-back': state.setupStep -= 1; save(); render(); break;
    case 'setup-done': state.setupStep = 4; state.active = 'a'; state.town = null; save(); render(); break;
    case 'town': state.town = val; whyNot = null; suggestBar = null; closeSheet(); save(); render(); break;

    // preferences
    case 'pref-seg': state.partners[el.dataset.p][key] = key === 'maxCommute' ? Number(val) : val; refresh(); break;
    case 'pref-pick': {
      const pr = state.partners[el.dataset.p];
      pr[key] = pr[key].includes(val) ? pr[key].filter((x) => x !== val) : [...pr[key], val];
      refresh(); break;
    }
    case 'prefs-who': prefsWho = val; drawSheet(true); break;

    // filters
    case 'f-seg': f[key] = Number(val); refresh(); break;
    case 'f-pick': f[key] = f[key].includes(val) ? f[key].filter((x) => x !== val) : [...f[key], val]; refresh(); break;
    case 'f-flood': f.hideHighFlood = el.checked; refresh(); break;
    case 'f-clear': state.filters = defaultFilters(); refresh(); break;
    case 'fin': state.finance[key] = Number(val); refresh(); break;
    case 'apply-suggest':
      if (key === 'sizes') f.sizes = SIZE_BUCKETS.map(([b]) => b).filter((b) => b >= Number(val)).map(String);
      else f[key] = Number(val); $('#toast').hidden = true; refresh(); toast('Filters updated for both of you'); break;

    // navigation
    case 'view': state.view = el.dataset.view; whyNot = null; suggestBar = null; $('#toast').hidden = true; closeSheet(); save(); render(); $('.main').scrollTop = 0; break;
    case 'goto': state.view = el.dataset.view; closeSheet(); save(); render(); break;
    case 'sheet':
      if (Date.now() < voteLock) break;
      $('#toast').hidden = true; openSheet(el.dataset.name, id); break;
    case 'close': closeSheet(); break;
    case 'switch': if (!animating) openSheet('handoff'); break;
    case 'confirm-switch': $('#toast').hidden = true; state.active = other(state.active); whyNot = null; suggestBar = null; closeSheet(); save(); render(); break;

    // swiping
    case 'like': case 'pass': case 'love': swipe(act); break;
    case 'sheet-swipe': clickShield = Date.now() + 400; closeSheet(); swipe(val); break;
    case 'undo': undo(); break;
    case 'review-passes':
      townPool().forEach((l) => { if (state.swipes[state.active][l.id] === 'pass') delete state.swipes[state.active][l.id]; });
      state.lastSwipe = null; save(); render(); break;
    case 'details': openSheet('details', id); break;
    case 'why': recordWhy(val); break;
    case 'why-skip': whyNot = null; render(); break;
    case 'suggest-skip': render(); break;

    // matches
    case 'mmode': $('#toast').hidden = true; state.matchesMode = val; save(); render(); break;
    case 'cmp': {
      if (state.compare.includes(id)) state.compare = state.compare.filter((x) => x !== id);
      else if (state.compare.length >= 3) { el.checked = false; toast('You can compare up to 3 homes'); break; } else state.compare.push(id);
      save(); render();
      if (state.compare.length >= 2) toast(`${state.compare.length} homes selected`, { act: 'mmode', label: 'Compare', data: 'data-val="compare"' });
      break;
    }
    case 'unmatch':
      state.swipes[state.active][id] = 'pass';
      state.compare = state.compare.filter((x) => x !== id);
      save(); render(); toast(`Removed. Marked as a pass for ${nm(state.active)}.`); break;
    case 'react': {
      const r = state.reactions[id] || (state.reactions[id] = {});
      r[state.active] = r[state.active] === val ? undefined : val;
      if (!r[state.active]) delete r[state.active];
      refresh(); break;
    }
    case 'second-look':
      state.stats.rethinks += 1;
      delete state.swipes[el.dataset.p][id];
      save(); render(); toast(`It's back in ${nm(el.dataset.p)}'s deck`); break;

    // final round
    case 'final-start': startFinal(); break;
    case 'final-restart': state.final = null; state.winner = null; save(); render(); break;
    case 'final-vote': finalVote(id); break;
    case 'coin': {
      const fr = state.final;
      const pickId = fr.pool[Math.random() < 0.5 ? 0 : 1];
      fr.votes = { a: pickId, b: pickId };
      save(); render(); toast(`The coin picked ${esc(byId(pickId).address)}`); break;
    }
    case 'final-next': finalNext(); break;
    case 'final-revote': state.final.votes = { a: null, b: null }; state.final.phase = 'a'; state.active = 'a'; save(); render(); break;
    case 'final-keep': {
      const fr = state.final;
      fr.pool.push(fr.pool.shift(), fr.pool.shift());
      fr.votes = { a: null, b: null }; fr.phase = 'a'; state.active = 'a'; save(); render(); break;
    }
    case 'ag-when': el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'agent-submit': {
      const name = $('#ag-name').value.trim();
      const email = $('#ag-email').value.trim();
      const phone = $('#ag-phone').value.trim();
      const digits = phone.replace(/\D/g, '');
      if (!name) { toast('Add your name'); break; }
      if (!email && !phone) { toast('Add an email or phone so the agent can reach you'); break; }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { toast('That email doesn\'t look right'); break; }
      if (phone && (digits.length < 10 || digits.length > 11)) { toast('Enter a 10-digit phone number'); break; }
      if (!$('#ag-consent').checked) { toast('Please check the consent box to continue'); break; }
      // Demo: contact details are not stored or sent. Only the homes, time and consent wording are kept.
      state.agentRequest = { id, ids: (el.dataset.ids || id).split(','), at: Date.now(), consent: $('#ag-consent').parentElement.textContent.trim() };
      save(); closeSheet(); render(); toast('Tour requested (demo, so nothing was sent)'); break;
    }
    case 'share': {
      const l = byId(id);
      const text = `We found the one! ${l.address}, ${l.city} ${l.state}. ${money(l.price)}, ${l.beds} bd / ${l.baths} ba, ${num(l.sqft)} sqft. Picked together on NestMatch.`;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        () => toast('Summary copied. Paste it in a text to family.'),
        () => toast(text),
      );
      break;
    }
    case 'cta': toast(el.dataset.msg); break;

    // data
    case 'load-live': loadLive(); break;
    case 'use-sample': state.source = 'sample'; state.filters = defaultFilters(); state.final = null; state.winner = null; state.compare = []; refresh(); break;
    // resets clear group-mode data too (groups.js) and reload, so neither file keeps stale state in memory
    case 'hard-reset': [STORE_KEY, GROUPS_KEY].forEach((k) => localStorage.removeItem(k)); location.reload(); break;
    case 'reset':
      if (confirm('Reset all swipes, matches, names and preferences?')) {
        [STORE_KEY, GROUPS_KEY].forEach((k) => localStorage.removeItem(k)); location.reload();
      }
      break;
    default: break;
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'na' || el.id === 'nb') {
    const v = el.value.trim() || (el.id === 'na' ? 'Partner 1' : 'Partner 2');
    state.partners[el.id === 'na' ? 'a' : 'b'].name = v; save();
    return;
  }
  if (el.dataset.act === 'rename') {
    const q = el.dataset.p;
    const v = el.value.trim();
    // empty or same-as-partner names are not saved; the field keeps what was typed until blur
    if (!v || v.toLowerCase() === state.partners[other(q)].name.toLowerCase()) return;
    state.partners[q].name = v;
    save();
    document.querySelectorAll(`[data-act="prefs-who"][data-val="${q}"] .tab-name`).forEach((n) => { n.textContent = v; });
    document.querySelectorAll(`[data-act="prefs-who"][data-val="${q}"] .avatar`).forEach((n) => { n.textContent = v.charAt(0); });
    render();
    return;
  }
  if (el.dataset.act !== 'f-range') return;
  const f = state.filters;
  const { lo, hi } = priceBounds();
  let v = Number(el.value);
  if (el.dataset.key === 'minPrice' && v > (f.maxPrice || hi)) v = f.maxPrice || hi;
  if (el.dataset.key === 'maxPrice' && v < (f.minPrice || lo)) v = f.minPrice || lo;
  el.value = v;
  f[el.dataset.key] = el.dataset.key === 'maxPrice' && v >= hi ? 0 : el.dataset.key === 'minPrice' && v <= lo ? 0 : v;
  document.querySelectorAll('#minLbl').forEach((n) => { n.textContent = shortMoney(f.minPrice || lo); });
  document.querySelectorAll('#maxLbl').forEach((n) => { n.textContent = shortMoney(f.maxPrice || hi) + (f.maxPrice ? '' : '+'); });
  document.querySelectorAll('#poolCount').forEach((n) => { n.innerHTML = poolCountText(pool().length); n.classList.toggle('zero', !pool().length); });
  save();
});
// after a slider is released, redraw so counts on buttons and the deck catch up
document.addEventListener('change', (e) => {
  if (e.target.dataset.act === 'rename') {
    const q = e.target.dataset.p;
    const v = e.target.value.trim();
    if (!v || v.toLowerCase() === state.partners[other(q)].name.toLowerCase()) {
      if (v) toast('That name is already taken by your partner');
      e.target.value = state.partners[q].name;
    }
  }
  if (e.target.dataset.act === 'f-range') refresh();
  if (e.target.dataset.act === 'msort') { state.matchSort = e.target.value; save(); render(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet) return sheet.name === 'countdown' ? null : closeSheet();
  if (window.NMGroups && NMGroups.takeover()) return;
  if (state.setupStep < 4 || state.view !== 'swipe' || sheet || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight') swipe('like');
  if (e.key === 'ArrowLeft') swipe('pass');
  if (e.key === 'ArrowUp') { e.preventDefault(); swipe('love'); }
});

// ---------- boot ----------
if (state.source === 'live' && !state.live) state.source = 'sample';
fetch('/api/status').then((r) => (r.ok ? r.json() : null)).then((s) => { serverLive = s ? s.live : null; }).catch(() => {});
render();
