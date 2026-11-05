// NestMatch group modes, owned by tot-41. See COLLABORATION.md.
// Couple mode is app.js, unchanged. This file adds:
//   - "Who's house hunting?" picker at sign-up (couple / family / solo)
//   - Family mode: 3+ members with roles (Decider / Voice / Explorer), match rules, polls,
//     a kid "Explorer" view (no prices, emoji swipes, "which room is mine?", dream features),
//     a family Final Round bracket and a moving-day countdown.
//   - Solo mode: "still love it?" re-swipes, invited advisors, taste-based picks,
//     solo life checks (one-income stress test, house hack, value, demo safety) and a bracket.
// It keeps its own storage key, so app.js's nestmatch-v2 shape never changes.
// It reads app.js globals read-only (listings, byId, passesFilters, payment, money, esc, icon, ...)
// and only renders through the hooks app.js calls: NMGroups.takeover/render/afterRender.
// All its clicks use data-g="..." (never data-act), and its popups live in #g-overlay.

(function () {
  const GKEY = 'nestmatch-groups-v1';
  const COLORS = 8; // member avatar colors g-m0..g-m7, defined in groups.css (max 8 members, so no repeats)
  const ROLES = {
    decider: { label: 'Decider', blurb: 'Makes the call. Usually parents or whoever is buying.' },
    voice: { label: 'Voice', blurb: 'Swipes and votes. Their picks always show up. Whether they count depends on your rule.' },
    explorer: { label: 'Explorer', blurb: 'Kid mode: photos and emojis, picks a room, no prices.' },
  };
  const RULES = {
    deciders: { label: 'Deciders decide', blurb: 'A home is a match when every Decider likes it. Everyone else\'s picks show up as hearts so you can see them.' },
    majority: { label: 'Majority wins', blurb: 'A match when more than half of the Deciders and Voices like it.' },
    veto: { label: 'Anyone can veto', blurb: 'A match when every Decider likes it and no Voice has said no.' },
    everyone: { label: 'Everyone\'s equal', blurb: 'A match only when everyone, kids included, likes it.' },
  };
  const KID_FEATURES = [
    ['Big yard', 'A big yard to play in'], ['Pool', 'A pool!'], ['Home office', 'A quiet homework spot'],
    ['Covered patio', 'A porch for summer'], ['Fireplace', 'A fireplace for cocoa nights'],
    ['Open floor plan', 'Lots of room to run'], ['Walk-in closets', 'A giant closet'], ['Smart home', 'Robot lights'],
  ];
  const ADVISOR_RELATIONS = ['Parent', 'Friend', 'Sibling', 'Agent', 'Other'];
  // Demo-only neighborhood scores. These are NOT real crime data; the UI says so wherever they appear.
  const DEMO_SAFETY = { 'Royal Oak': 8, Ferndale: 7, Birmingham: 9, Troy: 9, Novi: 9, Northville: 9, Plymouth: 8, Canton: 8, 'Grosse Pointe': 8, 'Ann Arbor': 8 };
  const RECHECK_AFTER = 6; // a liked home comes back as "still love it?" after this many more swipes

  // ---------- state ----------
  // Each mode has its own filters and loan settings, so family/solo never touch the couple's state.filters.
  const FILTER_ARRAYS = ['monthly', 'beds', 'baths', 'sizes', 'hoa', 'styles', 'hoods'];
  const gFilterDefaults = () => ({ minPrice: 0, maxPrice: 0, monthly: [], beds: [], baths: [], sizes: [], hoa: [], styles: [], hoods: [], hideHighFlood: false });
  function normFilters(f) {
    const o = { ...gFilterDefaults(), ...(f && typeof f === 'object' && !Array.isArray(f) ? f : {}) };
    FILTER_ARRAYS.forEach((k) => { o[k] = Array.isArray(o[k]) ? o[k].map(String) : []; });
    o.minPrice = Number(o.minPrice) || 0; o.maxPrice = Number(o.maxPrice) || 0; o.hideHighFlood = Boolean(o.hideHighFlood);
    return o;
  }
  const DOWN_OPTS = [3.5, 5, 10, 20];
  const RATE_OPTS = [5.5, 6, 6.5, 7];
  const normFinance = (x) => ({
    down: DOWN_OPTS.includes(Number(x && x.down)) ? Number(x.down) : 10,
    rate: RATE_OPTS.includes(Number(x && x.rate)) ? Number(x.rate) : 6.5,
  });
  const uid = () => Math.random().toString(36).slice(2, 9);
  const member = (name, role, color, work = 'remote') => ({ id: uid(), name, role, color, work, maxCommute: 0 });
  const defFamily = () => {
    const m = [member('Taylor', 'decider', 0, 'downtown'), member('Nick', 'decider', 1, 'troy'), member('Avery', 'voice', 2), member('Sam', 'explorer', 3)];
    return {
      step: 0, done: false, name: 'Our family', members: m, rule: 'deciders', dealbreakers: [],
      active: m[0].id, view: 'discover', swipes: {}, rooms: {}, wishlist: {}, polls: [], bracket: null, winner: null, moveDate: '',
      filters: gFilterDefaults(), finance: normFinance(),
    };
  };
  const defSolo = () => ({
    step: 0, done: false, name: 'Taylor', work: 'downtown', maxCommute: 0, dealbreakers: [], nice: [], income: 95000,
    househack: false, swipes: {}, count: 0, advisors: [], advisorOn: null, view: 'discover', bracket: null, winner: null,
    filters: gFilterDefaults(), finance: normFinance(),
  });
  const gDefault = () => ({ mode: null, family: defFamily(), solo: defSolo() });

  function gLoad() {
    const d = gDefault();
    try {
      const s = JSON.parse(localStorage.getItem(GKEY));
      if (!s || typeof s !== 'object') return d;
      const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
      const fam = { ...d.family, ...(obj(s.family) ? s.family : {}) };
      const ms = Array.isArray(fam.members) ? fam.members.filter(obj) : [];
      fam.members = ms.length ? ms.slice(0, 8).map((m, i) => ({
        ...m,
        id: typeof m.id === 'string' && m.id ? m.id : uid(),
        name: typeof m.name === 'string' && m.name.trim() ? m.name.slice(0, 16) : `Person ${i + 1}`,
        role: ROLES[m.role] ? m.role : 'voice',
        color: Number.isInteger(m.color) && m.color >= 0 ? m.color % COLORS : i,
        work: WORK_HUBS_SAFE(m.work), maxCommute: Number(m.maxCommute) || 0,
      })) : d.family.members;
      if (!fam.members.some((m) => m.role === 'decider')) fam.members[0].role = 'decider';
      fam.polls = (Array.isArray(fam.polls) ? fam.polls : []).filter((p) => obj(p) && ['h2h', 'feature', 'rank'].includes(p.type)
        && Array.isArray(p.options) && p.options.length >= 2 && p.options.every((o) => obj(o) && typeof o.id === 'string'))
        .map((p) => ({ ...p, q: String(p.q || 'Poll'), votes: obj(p.votes) ? p.votes : {} }));
      if (!Array.isArray(fam.dealbreakers)) fam.dealbreakers = [];
      fam.step = Math.min(3, Math.max(0, Number(fam.step) || 0));
      fam.filters = normFilters(fam.filters); fam.finance = normFinance(fam.finance);
      fam.bracket = validBracket(fam.bracket);
      if (typeof fam.winner !== 'string') fam.winner = null;
      if (typeof fam.moveDate !== 'string') fam.moveDate = '';
      ['swipes', 'rooms', 'wishlist'].forEach((k) => { if (!fam[k] || typeof fam[k] !== 'object') fam[k] = {}; });
      if (!RULES[fam.rule]) fam.rule = 'deciders';
      if (!fam.members.some((x) => x.id === fam.active)) fam.active = fam.members[0].id;
      const solo = { ...d.solo, ...(obj(s.solo) ? s.solo : {}) };
      solo.advisors = (Array.isArray(solo.advisors) ? solo.advisors : []).filter(obj)
        .map((a, i) => ({ ...a, id: typeof a.id === 'string' ? a.id : uid(), name: String(a.name || 'Advisor'), relation: String(a.relation || 'Other'), color: Number.isInteger(a.color) ? a.color % COLORS : (i + 1) % COLORS, votes: obj(a.votes) ? a.votes : {} }));
      if (!solo.advisors.some((a) => a.id === solo.advisorOn)) solo.advisorOn = null;
      solo.swipes = obj(solo.swipes) ? Object.fromEntries(Object.entries(solo.swipes).filter(([, v]) => obj(v) && typeof v.v === 'string')) : {};
      solo.count = Number(solo.count) || 0; solo.income = Number(solo.income) || 0;
      solo.step = Math.min(2, Math.max(0, Number(solo.step) || 0));
      solo.work = WORK_HUBS_SAFE(solo.work); solo.name = typeof solo.name === 'string' ? solo.name : 'Me';
      solo.filters = normFilters(solo.filters); solo.finance = normFinance(solo.finance);
      solo.bracket = validBracket(solo.bracket);
      if (typeof solo.winner !== 'string') solo.winner = null;
      ['dealbreakers', 'nice'].forEach((k) => { if (!Array.isArray(solo[k])) solo[k] = []; });
      return { mode: ['couple', 'family', 'solo'].includes(s.mode) ? s.mode : null, family: fam, solo };
    } catch (e) { return d; }
  }
  // gLoad runs at startup, after data.js but before app.js: data.js constants are safe here, app.js globals are not.
  function WORK_HUBS_SAFE(w) { return typeof WORK_HUBS !== 'undefined' && WORK_HUBS[w] ? w : 'remote'; }
  // Structure only; homes that no longer exist are caught at render time (checkBracket).
  function validBracket(b) {
    if (!b || typeof b !== 'object' || !Array.isArray(b.rounds) || !b.rounds.length) return null;
    const okRound = (r) => Array.isArray(r) && r.length && r.every((pr) => Array.isArray(pr) && pr.length >= 1 && pr.length <= 2 && pr.every((x) => typeof x === 'string'));
    if (!b.rounds.every(okRound)) return null;
    if (!Number.isInteger(b.round) || b.round < 0 || b.round >= b.rounds.length) return null;
    if (!Number.isInteger(b.m) || b.m < 0 || b.m >= b.rounds[b.round].length || b.rounds[b.round][b.m].length !== 2) return null;
    return { ...b, votes: b.votes && typeof b.votes === 'object' && !Array.isArray(b.votes) ? b.votes : {}, voter: Number.isInteger(b.voter) && b.voter >= 0 ? b.voter : 0, results: Array.isArray(b.results) ? b.results : [] };
  }
  let G = gLoad();
  let picking = false; // the "Who's house hunting?" screen is open
  let gSheet = null; // { name, arg }
  let gAnim = false;
  let pollDraft = null;
  const gMaps = [];
  const gSave = () => localStorage.setItem(GKEY, JSON.stringify(G));
  const F = () => G.family;
  const S = () => G.solo;
  const rerender = () => render(); // app.js render(), which hands off to us through the takeover hook

  // Existing couple users (finished or mid-setup) keep going in couple mode; brand-new users see the picker.
  function effectiveMode() {
    if (G.mode) return G.mode;
    return typeof state !== 'undefined' && state.setupStep > 0 ? 'couple' : null;
  }
  function takeover() {
    if (picking) return true;
    const m = effectiveMode();
    return m === null || m === 'family' || m === 'solo';
  }

  // ---------- shared helpers ----------
  const isLikeV = (v) => v === 'like' || v === 'love';
  const mById = (id) => F().members.find((m) => m.id === id);
  const activeM = () => mById(F().active);
  const isExplorer = () => G.mode === 'family' && activeM() && activeM().role === 'explorer';
  const av = (m, cls = '') => `<span class="avatar g-m${m.color % COLORS} ${cls}">${esc((m.name || '?').charAt(0))}</span>`;
  const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
  const gVibe = (l) => (VIBES.filter(([, label]) => label !== 'Commute hero').find(([t]) => t(l)) || [])[1];
  function hubCommute(l, work) {
    const hub = WORK_HUBS[work];
    if (!hub || hub.lat == null || l.lat == null) return null;
    const toRad = (d) => (d * Math.PI) / 180;
    const a = Math.sin(toRad(hub.lat - l.lat) / 2) ** 2 + Math.cos(toRad(l.lat)) * Math.cos(toRad(hub.lat)) * Math.sin(toRad(hub.lng - l.lng) / 2) ** 2;
    return Math.round(6371 * 2 * Math.asin(Math.sqrt(a)) * 1.55 + 5); // same rough rush-hour estimate as app.js
  }
  const modeObj = () => (G.mode === 'solo' ? S() : F());
  const MF = () => modeObj().filters;
  const MFin = () => modeObj().finance;
  function gPayment(l) { // app.js payment(), but with this mode's loan settings
    const { down, rate } = MFin();
    const loan = l.price * (1 - down / 100);
    const r = rate / 100 / 12;
    const pi = r ? (loan * r) / (1 - (1 + r) ** -360) : loan / 360;
    const tax = (l.price * l.taxRate) / 12;
    const ins = (l.price * 0.005) / 12;
    const pmi = down < 20 ? (loan * 0.005) / 12 : 0;
    return { pi, tax, ins, pmi, hoa: l.hoa || 0, total: pi + tax + ins + pmi + (l.hoa || 0) };
  }
  function gPasses(l, f = MF()) { // app.js passesFilters(), but with this mode's filters
    return (!f.minPrice || l.price >= f.minPrice) && (!f.maxPrice || l.price <= f.maxPrice)
      && (!f.monthly.length || f.monthly.includes(bucket(gPayment(l).total, MONTHLY_BUCKETS)))
      && (!f.beds.length || f.beds.includes(bucket(l.beds, BED_OPTS)))
      && (!f.baths.length || f.baths.includes(bucket(Math.floor(l.baths), BATH_OPTS)))
      && (!f.sizes.length || f.sizes.includes(bucket(l.sqft, SIZE_BUCKETS)))
      && (!f.hoa.length || f.hoa.includes(hoaKey(l)))
      && (!f.styles.length || f.styles.includes(l.style))
      && (!f.hoods.length || f.hoods.includes(l.hood))
      && !(f.hideHighFlood && l.flood === 'High');
  }
  const passesBreakers = (l, list) => list.every((d) => !DEALBREAKERS[d] || DEALBREAKERS[d](l));
  function gPool() {
    if (G.mode === 'solo') {
      const s = S();
      return listings().filter((l) => gPasses(l) && passesBreakers(l, s.dealbreakers)
        && !(s.maxCommute && (hubCommute(l, s.work) ?? 0) > s.maxCommute));
    }
    const f = F();
    return listings().filter((l) => gPasses(l) && passesBreakers(l, f.dealbreakers)
      && f.members.every((m) => m.role !== 'decider' || !m.maxCommute || (hubCommute(l, m.work) ?? 0) <= m.maxCommute));
  }

  // ---------- taste model ("AI match") ----------
  // Learns from swipes: features, style, town, bed count and price. Explainable on purpose.
  function tasteFrom(entries) { // entries: [[listing, 'like'|'love'|'pass'], ...]
    const w = {};
    const add = (k, v) => { w[k] = (w[k] || 0) + v; };
    const liked = [];
    entries.forEach(([l, v]) => {
      const s = v === 'love' ? 2 : v === 'like' ? 1 : -1;
      l.features.forEach((f) => add(`f:${f}`, s));
      add(`s:${l.style}`, s * 0.7);
      add(`h:${l.hood}`, s * 0.6);
      add(`b:${Math.min(l.beds, 5)}`, s * 0.4);
      if (s > 0) liked.push(l.price);
    });
    const avgPrice = liked.length ? liked.reduce((a, b) => a + b, 0) / liked.length : null;
    return { w, avgPrice, n: entries.length };
  }
  function tasteScore(t, l) {
    if (!t || t.n < 4) return null;
    let s = l.features.reduce((a, f) => a + (t.w[`f:${f}`] || 0), 0)
      + (t.w[`s:${l.style}`] || 0) + (t.w[`h:${l.hood}`] || 0) + (t.w[`b:${Math.min(l.beds, 5)}`] || 0);
    if (t.avgPrice) s -= (Math.abs(l.price - t.avgPrice) / t.avgPrice) * 4;
    return s;
  }
  // turn raw scores into a friendly 50-99% "match" across a set of homes
  function tastePct(t, homes) {
    const sc = homes.map((l) => tasteScore(t, l));
    if (sc.some((x) => x == null)) return {};
    const lo = Math.min(...sc); const hi = Math.max(...sc);
    return Object.fromEntries(homes.map((l, i) => [l.id, Math.round(50 + ((sc[i] - lo) / ((hi - lo) || 1)) * 49)]));
  }
  function tasteTraits(t) {
    const label = (k) => {
      const [kind, v] = [k.slice(0, 1), k.slice(2)];
      if (kind === 'f') return v.toLowerCase();
      if (kind === 's') return `${v} homes`;
      if (kind === 'h') return `homes in ${v}`;
      return `${v}${v === '5' ? '+' : ''} bedrooms`;
    };
    const ranked = Object.entries(t.w).sort((a, b) => b[1] - a[1]);
    return {
      loves: ranked.filter(([, v]) => v >= 1.5).slice(0, 3).map(([k]) => label(k)),
      skips: ranked.reverse().filter(([, v]) => v <= -1.5).slice(0, 3).map(([k]) => label(k)),
    };
  }
  const listJoin = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

  // ---------- family matching ----------
  const famSwipe = (mid, lid) => (F().swipes[mid] || {})[lid];
  function famStatus(l) {
    const f = F();
    const ms = f.members;
    const D = ms.filter((m) => m.role === 'decider');
    const V = ms.filter((m) => m.role === 'voice');
    const vote = (m) => famSwipe(m.id, l.id);
    const likes = (g) => g.filter((m) => isLikeV(vote(m))).length;
    const passes = (g) => g.filter((m) => vote(m) === 'pass').length;
    const eligible = { deciders: D, majority: [...D, ...V], veto: D, everyone: ms }[f.rule];
    let st = 'pending';
    if (f.rule === 'deciders') st = passes(D) ? 'no' : likes(D) === D.length && D.length ? 'match' : 'pending';
    if (f.rule === 'majority') { const E = [...D, ...V]; st = likes(E) > E.length / 2 ? 'match' : passes(E) >= E.length / 2 ? 'no' : 'pending'; }
    if (f.rule === 'veto') st = passes(D) || passes(V) ? 'no' : likes(D) === D.length && D.length ? 'match' : 'pending';
    if (f.rule === 'everyone') st = passes(ms) ? 'no' : likes(ms) === ms.length ? 'match' : 'pending';
    const others = ms.filter((m) => m.role !== 'decider');
    const kidsLove = others.length > 0 && others.every((m) => isLikeV(vote(m)));
    const almost = st === 'no' && likes(eligible) >= eligible.length / 2;
    return { st, almost, kidsLove, likes: likes(ms), voted: ms.filter(vote).length };
  }
  const famMatches = () => listings().filter((l) => famStatus(l).st === 'match');
  const famTaste = (mid) => tasteFrom(listings().flatMap((l) => {
    if (mid) return famSwipe(mid, l.id) ? [[l, famSwipe(mid, l.id)]] : [];
    return F().members.map((m) => famSwipe(m.id, l.id)).filter(Boolean).map((v) => [l, v]);
  }));
  // how much a member's vote counts in polls and the Final Round under the family's rule
  function weight(m) {
    const r = F().rule;
    if (r === 'everyone') return 1;
    if (r === 'deciders') return m.role === 'decider' ? 1 : 0;
    return m.role === 'explorer' ? 0 : 1;
  }

  // ---------- solo ----------
  const soloSw = (id) => S().swipes[id];
  const soloDue = () => listings().filter((l) => { const s = soloSw(l.id); return s && isLikeV(s.v) && !s.re && S().count - s.n >= RECHECK_AFTER; });
  const soloSure = () => listings().filter((l) => { const s = soloSw(l.id); return s && s.re === 'yes'; });
  const soloLiked = () => listings().filter((l) => { const s = soloSw(l.id); return s && isLikeV(s.v) && s.re !== 'no'; });
  const soloTaste = () => tasteFrom(listings().flatMap((l) => { const s = soloSw(l.id); if (!s) return []; return [[l, s.re === 'no' ? 'pass' : s.re === 'yes' ? 'love' : s.v]]; }));
  function advisorTally(id) {
    const vs = S().advisors.map((a) => [a, a.votes && a.votes[id]]).filter(([, v]) => v);
    return vs;
  }
  function lifeChecks(l) {
    const s = S();
    const pay = gPayment(l);
    const monthlyIncome = (s.income || 0) / 12;
    const ratio = monthlyIncome ? pay.total / monthlyIncome : null;
    const town = listings().filter((x) => x.hood === l.hood && x.sqft);
    const avgPpsf = town.reduce((a, x) => a + x.price / x.sqft, 0) / (town.length || 1);
    const ppsf = l.sqft ? l.price / l.sqft : null;
    const value = ppsf ? Math.round(((avgPpsf - ppsf) / avgPpsf) * 100) : null;
    const hood = HOODS.find((h) => h.name === l.hood);
    const roomRent = Math.round((450 + (hood ? hood.ppsf : 180) * 1.6) / 25) * 25; // rough per-room rent estimate
    const rooms = Math.max(0, l.beds - 1);
    return {
      pay, ratio, value, ppsf, avgPpsf, rooms, roomRent,
      afterRent: pay.total - rooms * roomRent,
      safety: DEMO_SAFETY[l.hood] || null,
      commute: hubCommute(l, s.work),
    };
  }

  // ---------- render ----------
  function gRender(app) {
    try { gRenderUnsafe(app); } catch (err) {
      console.error(err);
      gSheet = null; overlayEl().hidden = true;
      app.innerHTML = `<div class="empty" style="margin:24px"><h2>Something went wrong</h2><p>Your saved ${esc(G.mode || 'group')} data looks damaged. Resetting clears just that mode.</p>
        <button class="btn primary" data-g="mode-repair">Reset ${esc(G.mode || 'group')} mode</button><button class="btn ghost" data-act="hard-reset">Reset the whole demo</button></div>`;
    }
  }
  function gRenderUnsafe(app) {
    gMaps.splice(0).forEach((m) => m.remove());
    const prev = app.querySelector('.main');
    const key = viewKey();
    const keep = prev && prev.dataset.view === key ? prev.scrollTop : 0;
    if (picking || effectiveMode() === null) {
      app.innerHTML = `<div class="onboard"><div class="main" data-view="${key}">${renderPicker()}</div></div>`;
    } else if (G.mode === 'family' && !F().done) {
      app.innerHTML = `<div class="onboard"><div class="main" data-view="${key}">${famSetup()}</div></div>`;
    } else if (G.mode === 'solo' && !S().done) {
      app.innerHTML = `<div class="onboard"><div class="main" data-view="${key}">${soloSetup()}</div></div>`;
    } else if (G.mode === 'solo' && S().advisorOn) {
      app.innerHTML = `<div class="onboard"><div class="main" data-view="${key}">${advisorMode()}</div></div>`;
    } else {
      app.innerHTML = shell();
    }
    const main = app.querySelector('.main');
    if (main && keep) main.scrollTop = keep;
    const top = app.querySelector('.g-deck .card:not(.behind)');
    if (top) attachDrag(top);
    mountGMaps(app);
    if (gSheet) drawSheet(true);
  }
  function viewKey() {
    if (picking || !effectiveMode()) return 'g-pick';
    const o = G.mode === 'family' ? F() : S();
    return o.done ? `g-${G.mode}-${o.view}` : `g-${G.mode}-setup${o.step}`;
  }

  function navDefs() {
    if (G.mode === 'solo') {
      return [['discover', 'home', 'Discover'], ['shortlist', 'matches', 'Shortlist', soloSure().length || null],
        ['advisors', 'user', 'Advisors'], ['taste', 'sparkle', 'For you'], ['bracket', 'trophy', 'Bracket']];
    }
    if (isExplorer()) {
      return [['discover', 'home', 'Explore'], ['matches', 'matches', 'Our list', famMatches().length || null],
        ['polls', 'chart', 'Polls', openPollsFor(F().active) || null], ['dreams', 'star', 'My dreams'],
        ...(F().bracket || F().winner ? [['final', 'trophy', 'Final Round', F().bracket ? '!' : null]] : [])];
    }
    return [['discover', 'home', 'Discover'], ['matches', 'matches', 'Matches', famMatches().length || null],
      ['polls', 'chart', 'Polls', openPollsFor(F().active) || null], ['family', 'user', 'Family'], ['final', 'trophy', 'Final Round']];
  }
  function shell() {
    const o = G.mode === 'family' ? F() : S();
    const defs = navDefs();
    if (!defs.some(([v]) => v === o.view)) o.view = 'discover';
    const nav = (short) => defs.map(([v, ic, label, badge]) => `<button class="nav-item${o.view === v ? ' on' : ''}" data-g="view" data-val="${v}">
      ${icon(ic)}<span>${short && label === 'Final Round' ? 'Final' : label}</span>${badge ? `<b class="badge">${badge}</b>` : ''}</button>`).join('');
    const who = G.mode === 'family'
      ? `<button class="who" data-g="sheet" data-val="who" title="Switch member">${av(activeM())}<span class="who-name">${esc(activeM().name)}</span>${icon('swap')}</button>`
      : `<span class="who g-solo-who">${av({ name: S().name, color: 0 })}<span class="who-name">${esc(S().name)}</span></span>`;
    const views = G.mode === 'family'
      ? { discover: famDiscover, matches: famMatchesView, polls: pollsView, family: familyView, final: bracketView, dreams: dreamsView }
      : { discover: soloDiscover, shortlist: shortlistView, advisors: advisorsView, taste: tasteView, bracket: bracketView };
    const label = G.mode === 'family' ? `${esc(F().name)} · ${plural(F().members.length, 'member')}` : 'Solo search';
    return `<div class="shell g-shell${isExplorer() ? ' g-kid' : ''}">
      <aside class="side">
        <div class="brand">${brandMark()}<span>NestMatch</span></div>
        <nav class="side-nav">${nav(false)}</nav>
        <div class="side-foot">
          ${who}
          ${isExplorer() ? '' : `<button class="side-link" data-g="sheet" data-val="filters">${icon('sliders')}Filters</button>
          <button class="side-link" data-g="sheet" data-val="settings">${icon('user')}${G.mode === 'family' ? 'Family settings' : 'Settings'}</button>
          <button class="side-link" data-g="change-mode">${icon('swap')}Change group</button>`}
          <p class="side-src">${label} · ${sourceLabel()}</p>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div class="brand">${brandMark()}<span>NestMatch</span></div>
          ${who}
          ${isExplorer() ? '' : `<button class="icon-btn" data-g="sheet" data-val="filters" aria-label="Filters">${icon('sliders')}</button>
          <button class="icon-btn" data-g="sheet" data-val="settings" aria-label="Settings">${icon('user')}</button>`}
        </header>
        <main class="main view-${o.view === 'discover' ? 'swipe' : o.view} g-view-${o.view}" data-view="${viewKey()}">${views[o.view]()}</main>
        <nav class="tabs">${nav(true)}</nav>
      </div>
    </div>`;
  }

  // ---------- picker ----------
  function renderPicker() {
    const cur = effectiveMode();
    const opt = (mode, ic, title, blurb, bullets) => `<button class="g-mode${cur === mode ? ' on' : ''}" data-g="pick-mode" data-val="${mode}">
      <span class="g-mode-ic">${icon(ic)}</span>
      <span class="g-mode-body"><b>${title}</b><span>${blurb}</span><span class="g-mode-list">${bullets.map((b) => `<i>${b}</i>`).join('')}</span></span>
      ${cur === mode ? '<span class="town-tag">Current</span>' : icon('right', 'g-mode-go')}
    </button>`;
    const pics = [4, 7, 11].map((n) => `<img src="${PHOTO_BASE}home${n}.jpg" alt="" draggable="false">`).join('');
    return `<div class="setup g-picker">
      <div class="collage">${pics}</div>
      <div class="brand big">${brandMark()}<span>NestMatch</span></div>
      <h1>Who's house hunting?</h1>
      <p class="lede">NestMatch works differently depending on who's deciding. Pick one. You can switch later, and each group keeps its own swipes.</p>
      <div class="g-modes">
        ${opt('couple', 'heart', 'Couple', 'You each swipe privately. When you both say yes, it\'s a match.', ['2 people', 'Matches', 'Final Round'])}
        ${opt('family', 'home', 'Family or group', 'Three or more people: family, roommates or co-buyers. Everyone gets a say.', ['3+ people', 'Roles', 'Polls', 'Kid mode'])}
        ${opt('solo', 'user', 'Just me', 'Buying on your own, with backup when you want it.', ['Still love it?', 'Advisors', 'Bracket'])}
      </div>
      ${picking && cur ? '<button class="btn ghost" data-g="pick-cancel">Cancel</button>' : ''}
      <p class="fine">Demo with sample listings. Saved only in this browser.</p>
    </div>`;
  }

  // ---------- family setup ----------
  function famSetup() {
    const f = F();
    const steps = `<div class="steps">${[0, 1, 2, 3].map((i) => `<i class="${i <= f.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const back = `<button class="btn ghost" data-g="fs-back">Back</button>`;
    if (f.step === 0) {
      const row = (m) => `<div class="g-member">
        ${av(m)}
        <input type="text" maxlength="16" value="${esc(m.name)}" data-g-in="mname" data-id="${m.id}" aria-label="Name">
        <div class="seg g-roles">${Object.keys(ROLES).map((r) => `<button class="${m.role === r ? 'on' : ''}" data-g="mrole" data-id="${m.id}" data-val="${r}">${ROLES[r].label}</button>`).join('')}</div>
        ${f.members.length > 3 ? `<button class="icon-btn g-remove" data-g="mremove" data-id="${m.id}" aria-label="Remove ${esc(m.name)}">${icon('x')}</button>` : ''}
      </div>`;
      return `<div class="setup">
        ${steps}
        <h1>Who's in your house hunt?</h1>
        <p class="lede">Add everyone who'll help pick. Give each person a role so the app knows whose vote decides.</p>
        <label class="field"><span>Family or group name</span><input type="text" maxlength="24" value="${esc(f.name)}" data-g-in="fname"></label>
        <div class="g-members">${f.members.map(row).join('')}</div>
        ${f.members.length < 8 ? `<button class="btn ghost" data-g="madd">+ Add someone</button>` : ''}
        <div class="g-role-key">${Object.entries(ROLES).map(([, r]) => `<p><b>${r.label}:</b> ${r.blurb}</p>`).join('')}</div>
        <div class="two"><button class="btn ghost" data-g="change-mode">Back</button>
        <button class="btn primary" data-g="fs-next">Next: how you decide</button></div>
      </div>`;
    }
    if (f.step === 1) {
      return `<div class="setup">
        ${steps}
        <h1>How does your family decide?</h1>
        <p class="lede">Pick the rule for what counts as a match. It also decides how polls and the Final Round are counted. You can change it any time.</p>
        <div class="g-rules">${Object.entries(RULES).map(([k, r]) => `<button class="g-rule${f.rule === k ? ' on' : ''}" data-g="rule" data-val="${k}"><b>${r.label}</b><span>${r.blurb}</span></button>`).join('')}</div>
        <div class="two">${back}<button class="btn primary" data-g="fs-next">Next: must-haves</button></div>
      </div>`;
    }
    if (f.step === 2) {
      const D = f.members.filter((m) => m.role === 'decider');
      return `<div class="setup">
        ${steps}
        <h1>Family must-haves</h1>
        <p class="lede">Dealbreakers hide a home for everyone, so nobody falls for a house you'd never buy.</p>
        <div class="group"><div class="label">Dealbreakers</div>
          <div class="picks">${Object.keys(DEALBREAKERS).map((d) => `<button class="pick${f.dealbreakers.includes(d) ? ' on' : ''}" data-g="fdeal" data-val="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
        ${D.map((m) => `<div class="group g-commute-set">
          <div class="label">${av(m, 'xs')} Where does ${esc(m.name)} work?</div>
          <div class="seg">${Object.keys(WORK_HUBS).map((k) => `<button class="${m.work === k ? 'on' : ''}" data-g="mwork" data-id="${m.id}" data-val="${k}">${esc(WORK_HUBS[k].name)}</button>`).join('')}</div>
          ${m.work !== 'remote' ? `<div class="seg">${[0, 20, 30, 45, 60].map((v) => `<button class="${m.maxCommute === v ? 'on' : ''}" data-g="mcommute" data-id="${m.id}" data-val="${v}">${v ? `${v} min max` : 'Any commute'}</button>`).join('')}</div>` : ''}
        </div>`).join('')}
        <div class="poolcount">${icon('home')}<span><b>${gPool().length}</b> of ${listings().length} homes pass your must-haves</span></div>
        <div class="two">${back}<button class="btn primary" data-g="fs-next">Next: budget</button></div>
      </div>`;
    }
    return `<div class="setup">
      ${steps}
      <h1>Set the budget</h1>
      <p class="lede">The Deciders set this. Explorers never see prices.</p>
      ${gFiltersForm()}
      <div class="two">${back}<button class="btn primary" data-g="fs-done" ${gPool().length ? '' : 'disabled'}>Start exploring</button></div>
    </div>`;
  }

  // ---------- solo setup ----------
  function soloSetup() {
    const s = S();
    const steps = `<div class="steps">${[0, 1, 2].map((i) => `<i class="${i <= s.step ? 'on' : ''}"></i>`).join('')}</div>`;
    const back = `<button class="btn ghost" data-g="ss-back">Back</button>`;
    if (s.step === 0) {
      return `<div class="setup">
        ${steps}
        <h1>Let's find <em>your</em> place.</h1>
        <p class="lede">Buying alone means nobody to double-check you. NestMatch fills that gap three ways:</p>
        <ul class="value">
          <li>${icon('undo')}<span><b>Still love it?</b> Homes you like come back later for a second look. Like it twice and it's a sure thing.</span></li>
          <li>${icon('user')}<span><b>Advisors.</b> Invite a parent, friend or agent to weigh in. You keep the final say.</span></li>
          <li>${icon('trophy')}<span><b>Bracket.</b> Your favorites go head to head until one is left.</span></li>
        </ul>
        <label class="field"><span>Your name</span><input type="text" maxlength="20" value="${esc(s.name)}" data-g-in="sname"></label>
        <div class="group"><div class="label">Where do you work?</div>
          <div class="seg">${Object.keys(WORK_HUBS).map((k) => `<button class="${s.work === k ? 'on' : ''}" data-g="swork" data-val="${k}">${esc(WORK_HUBS[k].name)}</button>`).join('')}</div></div>
        ${s.work !== 'remote' ? `<div class="group"><div class="label">Longest commute you'd accept</div>
          <div class="seg">${[0, 20, 30, 45, 60].map((v) => `<button class="${s.maxCommute === v ? 'on' : ''}" data-g="scommute" data-val="${v}">${v ? `${v} min` : 'Any'}</button>`).join('')}</div></div>` : ''}
        <div class="two"><button class="btn ghost" data-g="change-mode">Back</button><button class="btn primary" data-g="ss-next">Next</button></div>
      </div>`;
    }
    if (s.step === 1) {
      return `<div class="setup">
        ${steps}
        <h1>What has to work on one income?</h1>
        <p class="lede">We use your income only on this device, to show if a home is comfortable or a stretch.</p>
        <label class="field"><span>Yearly income before taxes</span><input type="number" min="0" step="1000" value="${s.income || ''}" data-g-in="income" inputmode="numeric"></label>
        <label class="toggle"><input type="checkbox" data-g="househack" ${s.househack ? 'checked' : ''}><span>I'd consider renting out spare rooms (house hacking)</span></label>
        <div class="group"><div class="label">Dealbreakers <span class="hint-inline">must have, or the home is hidden</span></div>
          <div class="picks">${Object.keys(DEALBREAKERS).map((d) => `<button class="pick${s.dealbreakers.includes(d) ? ' on' : ''}" data-g="sdeal" data-val="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
        <div class="group"><div class="label">Nice to have</div>
          <div class="picks">${FEATURES.map((d) => `<button class="pick${s.nice.includes(d) ? ' on' : ''}" data-g="snice" data-val="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
        <div class="poolcount">${icon('home')}<span><b>${gPool().length}</b> of ${listings().length} homes pass your dealbreakers</span></div>
        <div class="two">${back}<button class="btn primary" data-g="ss-next">Next: budget</button></div>
      </div>`;
    }
    return `<div class="setup">
      ${steps}
      <h1>Set your budget</h1>
      <p class="lede">Tip: keep the monthly payment under about 28% of your monthly income.${s.income ? ` For you that's about <b>${money((s.income / 12) * 0.28)}/mo</b>.` : ''}</p>
      ${gFiltersForm()}
      <div class="two">${back}<button class="btn primary" data-g="ss-done" ${gPool().length ? '' : 'disabled'}>Start swiping</button></div>
    </div>`;
  }

  // ---------- filters (per mode) ----------
  function gFiltersForm() {
    const f = MF(); const fin = MFin();
    const { lo, hi } = priceBounds();
    const min = f.minPrice || lo; const max = f.maxPrice || hi;
    const chips = (key, opts) => `<div class="picks">${opts.map(([v, label]) => `<button class="pick${f[key].includes(String(v)) ? ' on' : ''}" data-g="f-pick" data-key="${key}" data-val="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
    const plain = (key, vals) => chips(key, vals.map((v) => [v, v]));
    const seg = (key, opts) => `<div class="seg">${opts.map((v) => `<button class="${fin[key] === v ? 'on' : ''}" data-g="fin" data-key="${key}" data-val="${v}">${v}%</button>`).join('')}</div>`;
    return `
      <p class="fine pick-note">Pick as many as you like in each question. Leave one blank for any.</p>
      <div class="group"><div class="label">Price</div>
        <div class="range-vals"><b id="g-minLbl">${shortMoney(min)}</b><span>to</span><b id="g-maxLbl">${shortMoney(max)}${max >= hi ? '+' : ''}</b></div>
        <div class="dual">
          <input type="range" min="${lo}" max="${hi}" step="25000" value="${min}" data-g-in="f-range" data-key="minPrice" aria-label="Minimum price">
          <input type="range" min="${lo}" max="${hi}" step="25000" value="${max}" data-g-in="f-range" data-key="maxPrice" aria-label="Maximum price">
        </div></div>
      <div class="group"><div class="label">Monthly payment <span class="hint-inline">${fin.down}% down · ${fin.rate}% rate</span></div>${chips('monthly', MONTHLY_BUCKETS)}</div>
      <div class="two"><div class="group"><div class="label">Down payment</div>${seg('down', DOWN_OPTS)}</div><div class="group"><div class="label">Rate</div>${seg('rate', RATE_OPTS)}</div></div>
      <div class="two"><div class="group"><div class="label">Beds</div>${chips('beds', BED_OPTS)}</div><div class="group"><div class="label">Baths</div>${chips('baths', BATH_OPTS)}</div></div>
      <div class="group"><div class="label">Size <span class="hint-inline">sqft</span></div>${chips('sizes', SIZE_BUCKETS)}</div>
      <div class="group"><div class="label">Style</div>${plain('styles', styleOptions())}</div>
      <div class="group"><div class="label">Towns</div>${plain('hoods', hoodOptions())}</div>
      <div class="group"><div class="label">HOA</div>${chips('hoa', HOA_OPTS)}</div>
      <label class="toggle"><input type="checkbox" data-g="f-flood" ${f.hideHighFlood ? 'checked' : ''}><span>Hide homes in high flood-risk zones</span></label>
      <div class="poolcount${gPool().length ? '' : ' zero'}" id="g-poolCount">${poolText()}</div>`;
  }
  const poolText = () => `${icon('home')}<span><b>${gPool().length}</b> of ${listings().length} homes fit${G.mode === 'family' ? ' your filters and must-haves' : ''}</span>`;
  function filtersSheet() {
    return `<div class="sheet-head"><h2>Filters</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
      <p class="muted">${G.mode === 'family' ? `Shared by ${esc(F().name)}.` : 'Just for you.'} Couple mode keeps its own filters.</p>
      ${gFiltersForm()}
      <div class="two sticky-actions"><button class="btn ghost" data-g="f-clear">Clear all</button><button class="btn primary" data-g="close">Show ${gPool().length} homes</button></div>`;
  }

  // ---------- cards ----------
  function gCard(l, behind, opts = {}) {
    const kid = isExplorer();
    const pay = gPayment(l);
    const hints = [];
    if (G.mode === 'family' && !kid) {
      const wish = F().members.filter((m) => m.role === 'explorer' && (F().wishlist[m.id] || []).some((x) => l.features.includes(x)));
      if (wish.length) hints.push(`${icon('star')}${listJoin(wish.map((m) => esc(m.name)))} wished for this`);
    }
    if (opts.recheck) hints.push(`${icon('undo')}You liked this ${S().count - soloSw(l.id).n} swipes ago`);
    if (opts.pct) hints.push(`${icon('sparkle')}${opts.pct}% your taste`);
    return `<article class="card${behind ? ' behind' : ''}${opts.recheck ? ' g-recheck' : ''}" data-id="${l.id}">
      <div class="photo">
        ${photoTag(l, 0)}
        <div class="badges">
          ${opts.recheck ? '<span class="badge-pill g-pill">Still love it?</span>' : ''}
          ${!kid && l.dom != null && l.dom <= 7 ? `<span class="badge-pill new">New · ${l.dom}d</span>` : ''}
          ${!kid && l.originalPrice > l.price ? `<span class="badge-pill cut">${icon('tag')}Price cut ${shortMoney(l.originalPrice - l.price)}</span>` : ''}
        </div>
        <span class="stamp like">${kid ? '👍' : opts.recheck ? 'STILL' : 'LIKE'}</span><span class="stamp nope">${kid ? '👎' : 'NOPE'}</span><span class="stamp love">${kid ? '😍' : 'LOVE'}</span>
        <div class="photo-fade"></div>
        <div class="photo-text">
          ${gVibe(l) ? `<div class="vibe">${icon('sparkle')}${gVibe(l)}</div>` : ''}
          ${kid ? `<div class="price g-kid-title">${l.beds} bedrooms in ${esc(l.hood)}</div>`
            : `<div class="price">${money(l.price)}<span class="est">${money(pay.total)}/mo est.</span></div>
          <div class="addr">${esc(l.address)} · ${esc(l.hood)}</div>`}
          <div class="photo-facts">${kid ? `<span>${l.photos.length} photos to explore</span>` : `<span><b>${l.beds}</b> bd</span><span><b>${l.baths}</b> ba</span><span><b>${num(l.sqft)}</b> sqft</span>`}
            <span class="tap-hint">${icon('info')}${kid ? 'Tap to look inside' : 'Tap for details'}</span></div>
          ${hints.length ? `<div class="g-hints">${hints.map((h) => `<span>${h}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </article>`;
  }
  function actionsHTML(id, opts = {}) {
    if (opts.recheck) {
      return `<div class="actions g-recheck-actions">
        <button class="btn ghost" data-g="recheck" data-val="no">${icon('x')}Not anymore</button>
        <button class="btn primary" data-g="recheck" data-val="yes">${icon('heart')}Still love it</button>
      </div>`;
    }
    if (isExplorer()) {
      return `<div class="actions g-kid-actions">
        <button class="round lg pass" data-g="swipe" data-val="pass" aria-label="Not for me">👎</button>
        <button class="round lg love" data-g="swipe" data-val="love" aria-label="Love it">😍</button>
        <button class="round lg like" data-g="swipe" data-val="like" aria-label="I like it">👍</button>
      </div>`;
    }
    return `<div class="actions">
      <button class="round sm" data-g="undo" aria-label="Undo" ${canUndo() ? '' : 'disabled'}>${icon('undo')}</button>
      <button class="round lg pass" data-g="swipe" data-val="pass" aria-label="Pass">${icon('x')}</button>
      <button class="round md love" data-g="swipe" data-val="love" aria-label="Love it">${icon('star')}</button>
      <button class="round lg like" data-g="swipe" data-val="like" aria-label="Like">${icon('heart')}</button>
      <button class="round sm" data-g="sheet" data-val="details" data-id="${id}" aria-label="Details">${icon('info')}</button>
    </div>`;
  }
  let lastSwipe = null; // { who, id }
  const canUndo = () => lastSwipe && lastSwipe.who === (G.mode === 'family' ? F().active : 'solo');

  // ---------- family: discover ----------
  function famDeck(mid) {
    const mine = F().swipes[mid] || {};
    const t = famTaste();
    const othersLiked = (l) => F().members.filter((m) => m.id !== mid && isLikeV(famSwipe(m.id, l.id))).length;
    return gPool().filter((l) => !mine[l.id])
      .sort((x, y) => othersLiked(y) - othersLiked(x) || (tasteScore(t, y) ?? 0) - (tasteScore(t, x) ?? 0) || (x.dom ?? 99) - (y.dom ?? 99));
  }
  function famDiscover() {
    const m = activeM();
    const kid = m.role === 'explorer';
    const deck = famDeck(m.id);
    const total = gPool().length;
    const head = `<div class="deck-head">
      <div class="deck-meta"><div class="eyebrow">${kid ? `Hi ${esc(m.name)}!` : `${esc(m.name)} · ${ROLES[m.role].label}`}</div>
        <div class="deck-count">${!total ? 'No homes fit yet' : deck.length ? `${deck.length} of ${total} left${kid ? ' to explore' : ''}` : 'All caught up'}</div></div>
      ${kid ? '' : `<button class="pill-btn" data-g="sheet" data-val="filters">${icon('sliders')}Filters</button>`}
    </div>`;
    if (!total) {
      return `<div class="swipe-layout"><section class="deck-col">${head}<div class="empty"><div class="empty-ic">${icon('sliders')}</div>
        <h2>No homes fit right now</h2><p>Your filters and must-haves rule out every home.</p>
        <button class="btn primary" data-g="sheet" data-val="filters">Edit filters</button>
        <button class="btn ghost" data-g="sheet" data-val="settings">Edit must-haves</button></div></section></div>`;
    }
    if (!deck.length) {
      const next = F().members.find((x) => x.id !== m.id && famDeck(x.id).length);
      return `<div class="swipe-layout"><section class="deck-col">${head}<div class="empty"><div class="empty-ic">${icon('check')}</div>
        <h2>${kid ? 'You looked at every house!' : `You've seen every home, ${esc(m.name)}`}</h2>
        <p>${next ? `${esc(next.name)} still has ${famDeck(next.id).length} to go.` : `The whole family is done. You have ${plural(famMatches().length, 'match', 'matches')}.`}</p>
        ${next ? `<button class="btn primary" data-g="handoff" data-id="${next.id}">Pass to ${esc(next.name)}</button>` : `<button class="btn primary" data-g="view" data-val="matches">See ${kid ? 'our list' : 'matches'}</button>`}
        ${canUndo() ? '<button class="link" data-g="undo">Undo last swipe</button>' : ''}
      </div></section></div>`;
    }
    const [top, nxt] = deck;
    return `<div class="swipe-layout"><section class="deck-col">${head}
      <div class="deck g-deck">${nxt ? gCard(nxt, true) : ''}${gCard(top, false)}</div>
      ${actionsHTML(top.id)}
      <p class="kbd-hint">${kid ? 'Tap the house to look inside and pick your room!' : '← pass · ↑ love · → like · click the photo for full details'}</p>
    </section></div>`;
  }

  // ---------- solo: discover ----------
  function soloDeck() {
    const t = soloTaste();
    return gPool().filter((l) => !soloSw(l.id))
      .sort((x, y) => (tasteScore(t, y) ?? 0) - (tasteScore(t, x) ?? 0) || (x.dom ?? 99) - (y.dom ?? 99));
  }
  function soloDiscover() {
    const s = S();
    const due = soloDue();
    const deck = soloDeck();
    const total = gPool().length;
    const t = soloTaste();
    const head = `<div class="deck-head">
      <div class="deck-meta"><div class="eyebrow">${t.n >= 4 ? 'Sorted by your taste' : 'Discover'}</div>
        <div class="deck-count">${due.length ? `Second look · ${due.length} waiting` : deck.length ? `${deck.length} of ${total} left` : total ? `All caught up, ${esc(s.name)}` : 'No homes fit yet'}</div></div>
      <button class="pill-btn" data-g="sheet" data-val="filters">${icon('sliders')}Filters</button>
    </div>`;
    if (due.length) {
      const l = due[0];
      return `<div class="swipe-layout"><section class="deck-col">${head}
        <div class="deck g-deck">${deck[0] ? gCard(deck[0], true) : ''}${gCard(l, false, { recheck: true })}</div>
        ${actionsHTML(l.id, { recheck: true })}
        <p class="kbd-hint">Liking a home twice makes it a sure thing. ← not anymore · → still love it</p>
      </section></div>`;
    }
    if (!total) {
      return `<div class="swipe-layout"><section class="deck-col">${head}<div class="empty"><div class="empty-ic">${icon('sliders')}</div>
        <h2>No homes fit right now</h2><p>Your filters and dealbreakers rule out every home.</p>
        <button class="btn primary" data-g="sheet" data-val="filters">Edit filters</button></div></section></div>`;
    }
    if (!deck.length) {
      const waiting = soloLiked().filter((l) => !soloSw(l.id).re).length;
      return `<div class="swipe-layout"><section class="deck-col">${head}<div class="empty"><div class="empty-ic">${icon('check')}</div>
        <h2>You've seen every home</h2>
        <p>${soloSure().length} sure thing${soloSure().length === 1 ? '' : 's'} so far.${waiting ? ` ${waiting} liked home${waiting === 1 ? '' : 's'} still need a second look.` : ''}</p>
        ${waiting ? '<button class="btn primary" data-g="recheck-all">Give them a second look now</button>' : ''}
        <button class="btn ${waiting ? 'ghost' : 'primary'}" data-g="view" data-val="shortlist">See your shortlist</button>
        ${canUndo() ? '<button class="link" data-g="undo">Undo last swipe</button>' : ''}
      </div></section></div>`;
    }
    const pct = tastePct(t, gPool())[deck[0].id];
    return `<div class="swipe-layout"><section class="deck-col">${head}
      <div class="deck g-deck">${deck[1] ? gCard(deck[1], true) : ''}${gCard(deck[0], false, { pct })}</div>
      ${actionsHTML(deck[0].id)}
      <p class="kbd-hint">← pass · ↑ love · → like · liked homes come back for a second look</p>
    </section></div>`;
  }

  // ---------- swiping ----------
  function topCard() { return document.querySelector('.g-deck .card:not(.behind)'); }
  function gSwipe(dir) {
    const card = topCard();
    if (!card || gAnim) return;
    gAnim = true;
    const id = card.dataset.id;
    const recheck = card.classList.contains('g-recheck');
    const off = { like: 'translate(140%, 30px) rotate(22deg)', pass: 'translate(-140%, 30px) rotate(-22deg)', love: 'translate(0, -130%) rotate(0deg)' }[dir];
    card.style.transition = 'transform .32s ease';
    card.style.setProperty(dir === 'pass' ? '--nope' : dir === 'love' ? '--love' : '--like', 1);
    card.style.transform = off;
    setTimeout(() => {
      gAnim = false;
      if (recheck) return recheckAnswer(dir === 'pass' ? 'no' : 'yes');
      if (G.mode === 'solo') {
        const s = S();
        s.count += 1;
        s.swipes[id] = { v: dir, n: s.count };
        lastSwipe = { who: 'solo', id };
        gSave(); rerender();
        if (soloDue().length === 1 && soloDue()[0].id !== id) toast('A home you liked is back for a second look');
        return;
      }
      const f = F();
      const was = famStatus(byId(id)).st;
      (f.swipes[f.active] = f.swipes[f.active] || {})[id] = dir;
      lastSwipe = { who: f.active, id };
      gSave(); rerender();
      const st = famStatus(byId(id));
      if (st.st === 'match' && was !== 'match') { confetti(); openSheet('match', id); } else if (isExplorer()) toast(dir === 'pass' ? 'Okay, not that one!' : dir === 'love' ? 'You LOVE it! 😍' : 'Nice pick! 👍');
    }, 300);
  }
  function recheckAnswer(ans) {
    const card = topCard();
    const id = card && card.dataset.id;
    if (!id || !soloSw(id)) return;
    soloSw(id).re = ans;
    gSave(); rerender();
    if (ans === 'yes') { confetti(); toast('<b>Sure thing.</b> You liked it twice, so it\'s on your shortlist.'); } else toast('Good call. Off the shortlist.');
  }
  function gUndo() {
    if (!canUndo()) return;
    if (G.mode === 'solo') { delete S().swipes[lastSwipe.id]; S().count = Math.max(0, S().count - 1); } else delete (F().swipes[lastSwipe.who] || {})[lastSwipe.id];
    lastSwipe = null; gSave(); rerender();
  }
  function attachDrag(card) {
    let sx = 0; let sy = 0; let dx = 0; let dy = 0; let t0 = 0; let dragging = false; let moved = false;
    const recheck = card.classList.contains('g-recheck');
    card.addEventListener('pointerdown', (e) => {
      if (gAnim || e.button !== 0) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0; dy = 0; t0 = performance.now();
      card.setPointerCapture(e.pointerId); card.style.transition = 'none';
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
      const up = recheck ? 0 : Math.max(0, Math.min(1, -dy / 110)) * (Math.abs(dx) < 70 ? 1 : 0);
      card.style.setProperty('--like', up ? 0 : Math.max(0, Math.min(1, dx / 100)));
      card.style.setProperty('--nope', up ? 0 : Math.max(0, Math.min(1, -dx / 100)));
      card.style.setProperty('--love', up);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; card.style.transition = '';
      const speed = Math.abs(dx) / Math.max(1, performance.now() - t0);
      const far = Math.abs(dx) > 110 || (Math.abs(dx) > 50 && speed > 0.6);
      if (!recheck && moved && dy < -120 && Math.abs(dx) < 90) return gSwipe('love');
      if (moved && Math.abs(dx) > Math.abs(dy) * 0.8 && far) return gSwipe(dx > 0 ? 'like' : 'pass');
      card.style.transform = '';
      ['--like', '--nope', '--love'].forEach((v) => card.style.setProperty(v, 0));
      if (!moved) openSheet('details', card.dataset.id);
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', () => { dragging = false; card.style.transition = ''; card.style.transform = ''; });
  }

  // ---------- family: matches / our list ----------
  function voteChips(l) {
    const me = F().active;
    const mineDone = famSwipe(me, l.id);
    return `<div class="g-votes">${F().members.map((m) => {
      const v = famSwipe(m.id, l.id);
      const show = mineDone || m.id === me; // you see others' picks only after you've swiped it yourself
      const cls = !v ? 'wait' : !show ? 'hidden' : isLikeV(v) ? 'yes' : 'no';
      const mark = !v ? '…' : !show ? icon('lock') : v === 'love' ? (m.role === 'explorer' ? '😍' : icon('star')) : isLikeV(v) ? (m.role === 'explorer' ? '👍' : icon('heart')) : (m.role === 'explorer' ? '👎' : icon('x'));
      return `<span class="g-vote ${cls}" title="${esc(m.name)}${!v ? ' hasn\'t swiped' : !show ? ' swiped (hidden until you swipe)' : ''}">${av(m, 'xs')}${mark}</span>`;
    }).join('')}</div>`;
  }
  function homeRow(l, extra = '') {
    const kid = isExplorer();
    const st = famStatus(l);
    const rooms = F().members.filter((m) => (F().rooms[m.id] || {})[l.id] != null);
    return `<button class="g-row" data-g="sheet" data-val="details" data-id="${l.id}">
      <span class="g-row-photo">${photoTag(l, 0)}${st.kidsLove ? '<span class="g-kids">Kids\' favorite 🎉</span>' : ''}</span>
      <span class="g-row-body">
        <b>${kid ? `${l.beds} bedrooms in ${esc(l.hood)}` : `${money(l.price)} · ${esc(l.hood)}`}</b>
        <span class="muted">${kid ? (gVibe(l) || esc(l.style)) : `${esc(l.address)} · ${l.beds} bd · ${l.baths} ba · ${money(gPayment(l).total)}/mo`}</span>
        ${voteChips(l)}
        ${rooms.length ? `<span class="g-rooms">${rooms.map((m) => `${av(m, 'xs')} picked a room`).join(' ')}</span>` : ''}
        ${extra}
      </span>
    </button>`;
  }
  function famMatchesView() {
    const kid = isExplorer();
    const m = famMatches();
    const pending = listings().filter((l) => { const s = famStatus(l); return s.st === 'pending' && s.likes > 0; });
    const almost = listings().filter((l) => famStatus(l).almost);
    const kidsFav = listings().filter((l) => famStatus(l).kidsLove && famStatus(l).st !== 'match');
    if (kid) {
      return `<div class="page-head"><div><div class="eyebrow">Our list</div><h1>${m.length ? 'Where we might move next!' : 'No picks yet'}</h1></div></div>
        <p class="muted g-sub">${m.length ? 'These are the houses the family agrees on so far. Tap one to look inside and pick your room.' : 'Keep exploring. When everyone likes a house, it shows up here.'}</p>
        ${m.length ? `<div class="map g-map" data-gmap="list"></div>` : ''}
        <div class="g-list">${m.map((l) => homeRow(l)).join('')}</div>`;
    }
    return `<div class="page-head">
        <div><div class="eyebrow">Matches · ${esc(RULES[F().rule].label)}</div><h1>${m.length ? `${plural(m.length, 'home')} the family agrees on` : 'No matches yet'}</h1></div>
        ${m.length >= 2 ? `<button class="btn primary small" data-g="view" data-val="final">${icon('trophy')}Final Round</button>` : ''}
      </div>
      ${m.length >= 2 ? `<div class="g-quick"><button class="pill-btn" data-g="poll-quick" data-val="rank">${icon('list')}Have everyone rank these</button><button class="pill-btn" data-g="poll-quick" data-val="h2h">${icon('columns')}Poll the top two</button></div>` : ''}
      ${m.length ? `<div class="map g-map" data-gmap="list"></div><div class="g-list">${m.map((l) => homeRow(l)).join('')}</div>` : `<div class="empty g-empty"><p>Matches show up when ${F().rule === 'everyone' ? 'everyone likes' : F().rule === 'majority' ? 'most of you like' : 'every Decider likes'} the same home.</p><button class="btn primary" data-g="view" data-val="discover">Keep swiping</button></div>`}
      ${kidsFav.length ? `<h3 class="sec-title">The kids love these 🎉 <span class="hint-inline">not a match yet</span></h3><div class="g-list">${kidsFav.map((l) => homeRow(l)).join('')}</div>` : ''}
      ${pending.length ? `<h3 class="sec-title">Waiting on votes</h3><div class="g-list">${pending.slice(0, 12).map((l) => homeRow(l)).join('')}</div>` : ''}
      ${almost.length ? `<h3 class="sec-title">Almost <span class="hint-inline">most liked it, but it didn't pass your rule</span></h3><div class="g-list">${almost.map((l) => homeRow(l, `<span class="link" data-g="poll-home" data-id="${l.id}">Put it to a family poll</span>`)).join('')}</div>` : ''}`;
  }

  // ---------- polls ----------
  const POLL_PRESETS = [
    ['Big yard or a finished basement?', ['Big yard', 'Finished basement']],
    ['Close to school or close to work?', ['Close to school', 'Close to work']],
    ['City energy or quiet suburbs?', ['City energy', 'Quiet suburbs']],
    ['Pool or a bigger house?', ['Pool', 'Bigger house']],
    ['Old-school charm or brand new?', ['Old-school charm', 'Brand new']],
  ];
  function openPollsFor(mid) { return F().polls.filter((p) => !p.closed && p.votes[mid] == null).length; }
  function pollResult(p) {
    const ms = F().members;
    const tally = {}; const raw = {};
    p.options.forEach((o) => { tally[o.id] = 0; raw[o.id] = 0; });
    ms.forEach((m) => {
      const v = p.votes[m.id];
      if (v == null) return;
      if (p.type === 'rank') v.forEach((oid, i) => { const pts = v.length - i; raw[oid] += pts; tally[oid] += pts * weight(m); });
      else { raw[v] += 1; tally[v] += weight(m); }
    });
    const best = (t) => p.options.slice().sort((a, b) => t[b.id] - t[a.id])[0];
    const counted = Object.values(tally).some((x) => x > 0) ? tally : raw; // if no counted votes yet, fall back to everyone
    // ties: same as the Final Round. Everyone's votes first, then a coin flip (saved, so it doesn't change on reload).
    const top = (t, opts) => { const mx = Math.max(...opts.map((o) => t[o.id])); return opts.filter((o) => t[o.id] === mx); };
    let tied = top(counted, p.options); let how = '';
    if (tied.length > 1 && counted !== raw) { const t2 = top(raw, tied); if (t2.length < tied.length) how = 'Tie broken by everyone\'s votes.'; tied = t2; }
    if (tied.length > 1) {
      if (!tied.some((o) => o.id === p.flip)) { p.flip = tied[Math.floor(Math.random() * tied.length)].id; gSave(); }
      tied = [tied.find((o) => o.id === p.flip)]; how = 'A perfect tie, so a coin flip decided.';
    }
    const kidVotes = ms.filter((m) => m.role !== 'decider' && p.votes[m.id] != null);
    return { tally: counted, raw, how, winner: tied[0], kidsPick: kidVotes.length ? best(Object.fromEntries(p.options.map((o) => [o.id, kidVotes.reduce((a, m) => a + (p.type === 'rank' ? (p.votes[m.id].length - p.votes[m.id].indexOf(o.id)) : p.votes[m.id] === o.id ? 1 : 0), 0)]))) : null };
  }
  function pollCard(p) {
    const me = activeM();
    const ms = F().members;
    const voted = ms.filter((m) => p.votes[m.id] != null);
    const reveal = p.closed || voted.length === ms.length;
    const mine = p.votes[me.id];
    const optLabel = (o) => (o.listingId && byId(o.listingId) ? `${isExplorer() ? `${byId(o.listingId).beds} bd in ${esc(byId(o.listingId).hood)}` : `${shortMoney(byId(o.listingId).price)} · ${esc(byId(o.listingId).hood)}`}` : esc(o.label));
    const optPhoto = (o) => (o.listingId && byId(o.listingId) ? `<span class="g-opt-photo">${photoTag(byId(o.listingId), 0)}</span>` : '');
    let body = '';
    if (reveal) {
      const r = pollResult(p);
      const max = Math.max(1, ...Object.values(r.raw));
      body = `<div class="g-results">${p.options.map((o) => `<div class="g-res${r.winner.id === o.id ? ' win' : ''}">
          ${optPhoto(o)}<span class="g-res-body"><b>${optLabel(o)}${r.winner.id === o.id ? ` <span class="g-win-tag">${icon('trophy')}Family pick</span>` : ''}</b>
          <span class="g-bar"><i style="width:${(r.raw[o.id] / max) * 100}%"></i></span>
          <span class="g-res-who">${p.type === 'rank' ? `<span class="muted">${r.raw[o.id]} pts${ms.some((m) => p.votes[m.id] && p.votes[m.id][0] === o.id) ? ' · first choice of' : ''}</span>` : ''}${ms.filter((m) => (p.type === 'rank' ? p.votes[m.id] && p.votes[m.id][0] === o.id : p.votes[m.id] === o.id)).map((m) => av(m, 'xs')).join('')}</span></span>
        </div>`).join('')}</div>
        ${r.kidsPick && r.kidsPick.id !== r.winner.id ? `<p class="g-note">${icon('star')}The kids picked <b>${optLabel(r.kidsPick)}</b>. Worth a talk?</p>` : ''}
        <p class="fine">Counted with "${esc(RULES[F().rule].label)}". ${F().rule === 'deciders' ? 'Everyone\'s votes are shown; Deciders\' votes decide.' : ''} ${r.how}</p>`;
    } else if (mine != null) {
      body = `<p class="g-note">${icon('lock')}Your vote is in. Results show when everyone has voted.</p>`;
    } else if (p.type === 'rank') {
      const order = (pollDraft && pollDraft.rankFor === p.id) ? pollDraft.order : p.options.map((o) => o.id);
      body = `<p class="muted small">Put them in order, favorite on top.</p><ol class="g-rank">${order.map((oid, i) => {
        const o = p.options.find((x) => x.id === oid);
        return `<li>${optPhoto(o)}<span class="g-rank-l">${i + 1}. ${optLabel(o)}</span>
          <button class="icon-btn" data-g="rank-move" data-id="${p.id}" data-val="${i}" data-dir="-1" ${i ? '' : 'disabled'} aria-label="Move up">${icon('chev', 'g-up')}</button>
          <button class="icon-btn" data-g="rank-move" data-id="${p.id}" data-val="${i}" data-dir="1" ${i < order.length - 1 ? '' : 'disabled'} aria-label="Move down">${icon('chev')}</button></li>`;
      }).join('')}</ol><button class="btn primary" data-g="rank-submit" data-id="${p.id}">Submit my ranking</button>`;
    } else {
      body = `<div class="g-opts${p.options.some((o) => o.listingId) ? ' homes' : ''}">${p.options.map((o) => `<button class="g-opt" data-g="poll-vote" data-id="${p.id}" data-val="${o.id}">${optPhoto(o)}<span>${optLabel(o)}</span></button>`).join('')}</div>`;
    }
    const by = mById(p.by);
    return `<section class="g-poll${reveal ? ' done' : ''}">
      <div class="g-poll-head"><span class="eyebrow">${{ h2h: 'Head to head', feature: 'Quick poll', rank: 'Rank them' }[p.type]}${by ? ` · from ${esc(by.name)}` : ''}</span>
        <span class="g-poll-count">${voted.length}/${ms.length} voted</span></div>
      <h3>${esc(p.q)}</h3>
      ${body}
      <div class="g-poll-foot">${ms.map((m) => `<span class="g-dot${p.votes[m.id] != null ? ' in' : ''}" title="${esc(m.name)}">${av(m, 'xs')}</span>`).join('')}
        ${!reveal && me.role === 'decider' && voted.length ? `<button class="link" data-g="poll-close" data-id="${p.id}">Reveal now</button>` : ''}
        ${me.role === 'decider' ? `<button class="link muted" data-g="poll-delete" data-id="${p.id}">Delete</button>` : ''}</div>
    </section>`;
  }
  function pollsView() {
    const ps = F().polls.slice().reverse();
    const me = F().active;
    const open = ps.filter((p) => !p.closed && p.votes[me] == null);
    const rest = ps.filter((p) => !open.includes(p));
    return `<div class="page-head"><div><div class="eyebrow">Family polls</div><h1>${open.length ? `${plural(open.length, 'poll')} waiting for you` : 'Polls'}</h1></div>
      <button class="btn primary small" data-g="sheet" data-val="new-poll">+ New poll</button></div>
      <p class="muted g-sub">Ask the family anything: which home, which feature, or rank the shortlist. Votes stay hidden until everyone has voted, so nobody just copies Mom or Dad.</p>
      ${!ps.length ? `<div class="g-presets">${POLL_PRESETS.slice(0, 3).map(([q], i) => `<button class="g-opt" data-g="poll-preset" data-val="${i}">${icon('chart')}<span>${esc(q)}</span></button>`).join('')}</div>` : ''}
      ${open.map(pollCard).join('')}${rest.map(pollCard).join('')}`;
  }
  function newPollSheet() {
    const d = pollDraft || (pollDraft = { type: 'feature', q: '', options: ['', ''], homes: [] });
    const homesPool = famMatches().length >= 2 ? famMatches() : listings().filter((l) => famStatus(l).likes > 0);
    return `<div class="sheet-head"><h2>New family poll</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
      <div class="tabs-inline">${[['feature', 'Quick question'], ['h2h', 'Home vs home'], ['rank', 'Rank homes']].map(([k, label]) => `<button class="${d.type === k ? 'on' : ''}" data-g="draft-type" data-val="${k}">${label}</button>`).join('')}</div>
      ${d.type === 'feature' ? `
        <div class="group"><div class="label">Ideas</div><div class="picks">${POLL_PRESETS.map(([q], i) => `<button class="pick" data-g="draft-preset" data-val="${i}">${esc(q)}</button>`).join('')}</div></div>
        <label class="field"><span>Question</span><input type="text" maxlength="80" value="${esc(d.q)}" data-g-in="draft-q" placeholder="What should we ask?"></label>
        ${d.options.map((o, i) => `<label class="field"><span>Option ${i + 1}</span><input type="text" maxlength="40" value="${esc(o)}" data-g-in="draft-opt" data-val="${i}"></label>`).join('')}
        ${d.options.length < 4 ? '<button class="link" data-g="draft-addopt">+ Add an option</button>' : ''}`
      : `<p class="muted">Pick ${d.type === 'h2h' ? '2 homes' : '3 to 5 homes'}${famMatches().length >= 2 ? ' from your matches' : ' anyone liked'}.</p>
        ${homesPool.length ? `<div class="g-pickhomes">${homesPool.map((l) => `<button class="g-pickhome${d.homes.includes(l.id) ? ' on' : ''}" data-g="draft-home" data-id="${l.id}">${photoTag(l, 0)}<span>${isExplorer() ? `${l.beds} bd` : shortMoney(l.price)} · ${esc(l.hood)}</span></button>`).join('')}</div>` : '<p class="g-note">Nobody has liked a home yet. Swipe a little first.</p>'}`}
      <div class="two sticky-actions"><button class="btn ghost" data-g="close">Cancel</button><button class="btn primary" data-g="poll-create">Send to the family</button></div>`;
  }
  function createPoll(type, q, options) {
    const p = { id: uid(), type, q, options: options.map((o) => ({ id: uid(), ...o })), votes: {}, by: F().active, closed: false, at: Date.now() };
    F().polls.push(p);
    pollDraft = null;
    gSave();
    return p;
  }
  const homeOpt = (id) => ({ listingId: id, label: byId(id).address });

  // ---------- family view (insights) ----------
  function familyView() {
    const f = F();
    const t = famTaste();
    const traits = tasteTraits(t);
    const ms = f.members;
    const pairs = [];
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const both = listings().filter((l) => famSwipe(ms[i].id, l.id) && famSwipe(ms[j].id, l.id));
        if (both.length >= 3) pairs.push([ms[i], ms[j], Math.round((both.filter((l) => isLikeV(famSwipe(ms[i].id, l.id)) === isLikeV(famSwipe(ms[j].id, l.id))).length / both.length) * 100), both.length]);
      }
    }
    pairs.sort((a, b) => b[2] - a[2]);
    const picks = Object.entries(tastePct(t, gPool())).filter(([id]) => !famSwipe(f.active, id)).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const wishers = ms.filter((m) => (f.wishlist[m.id] || []).length);
    return `<div class="page-head"><div><div class="eyebrow">${esc(f.name)}</div><h1>How your family is deciding</h1></div></div>
      <div class="g-cards">
        <section class="g-panel"><h3>Swipe progress</h3>${ms.map((m) => {
          const n = Object.keys(f.swipes[m.id] || {}).length; const tot = gPool().length || 1;
          return `<div class="g-prog">${av(m, 'sm')}<span>${esc(m.name)} <span class="muted">${ROLES[m.role].label}</span></span><span class="g-bar"><i style="width:${Math.min(100, (n / tot) * 100)}%"></i></span><b>${n}</b></div>`;
        }).join('')}</section>
        <section class="g-panel"><h3>Family taste</h3>${t.n >= 4 ? `
          ${traits.loves.length ? `<p>You keep liking <b>${listJoin(traits.loves)}</b>.</p>` : ''}
          ${traits.skips.length ? `<p class="muted">You tend to skip ${listJoin(traits.skips)}.</p>` : ''}
          ${picks.length ? `<div class="label">Homes we think the family will love</div><div class="g-mini">${picks.map(([id, pct]) => `<button class="g-mini-home" data-g="sheet" data-val="details" data-id="${id}">${photoTag(byId(id), 0)}<span><b>${pct}%</b> ${esc(byId(id).hood)}</span></button>`).join('')}</div>` : ''}`
          : '<p class="muted">Swipe a few more homes and we\'ll spot what the family keeps choosing.</p>'}</section>
        <section class="g-panel"><h3>Who agrees most</h3>${pairs.length ? pairs.slice(0, 5).map(([a, b, pct, n]) => `<div class="g-pair">${av(a, 'sm')}${av(b, 'sm')}<span>${esc(a.name)} & ${esc(b.name)}</span><b>${pct}%</b><span class="muted small">${n} homes</span></div>`).join('')
          : '<p class="muted">Once two people have swiped the same 3 homes, you\'ll see how in sync they are.</p>'}</section>
        <section class="g-panel"><h3>Kids' wishlist</h3>${wishers.length ? wishers.map((m) => `<div class="g-wish">${av(m, 'sm')}<span><b>${esc(m.name)}</b> dreams of ${listJoin((f.wishlist[m.id] || []).map((x) => (KID_FEATURES.find(([k]) => k === x) || [x, x])[1].toLowerCase()))}</span></div>`).join('')
          : '<p class="muted">Explorers can add dream features in "My dreams". They\'ll show up on matching homes for you.</p>'}</section>
      </div>`;
  }

  // ---------- explorer: my dreams ----------
  function dreamsView() {
    const m = activeM();
    const f = F();
    const wish = f.wishlist[m.id] || [];
    const rooms = Object.entries(f.rooms[m.id] || {}).filter(([id]) => byId(id));
    return `<div class="page-head"><div><div class="eyebrow">My dreams</div><h1>What would make it the best house ever, ${esc(m.name)}?</h1></div></div>
      <p class="muted g-sub">Tap everything you'd love. Your family will see it on houses that have it.</p>
      <div class="g-dreams">${KID_FEATURES.map(([k, label]) => `<button class="g-dream${wish.includes(k) ? ' on' : ''}" data-g="wish" data-val="${esc(k)}">${wish.includes(k) ? icon('star') : icon('sparkle')}<span>${esc(label)}</span></button>`).join('')}</div>
      <h3 class="sec-title">Rooms I picked</h3>
      ${rooms.length ? `<div class="g-mini">${rooms.map(([id, i]) => `<button class="g-mini-home" data-g="sheet" data-val="details" data-id="${id}">${photoTag(byId(id), Number(i))}<span>My room in ${esc(byId(id).hood)}</span></button>`).join('')}</div>`
        : '<p class="muted">Open any house and tap "This is my room!" on a photo.</p>'}
      ${f.winner && byId(f.winner) ? moveCountdown() : ''}`;
  }
  function moveCountdown() {
    const f = F();
    const l = byId(f.winner);
    const days = f.moveDate ? Math.ceil((new Date(`${f.moveDate}T12:00:00`) - Date.now()) / 86400000) : null;
    return `<section class="g-panel g-move">
      <div class="g-move-photo">${photoTag(l, 0)}</div>
      <div class="g-move-body"><div class="eyebrow">Where we're moving</div><h2>${esc(l.hood)}</h2>
        ${days == null ? '<p class="muted">Set a moving day to start the countdown.</p>'
          : days > 0 ? `<p class="g-days"><b>${days}</b> day${days === 1 ? '' : 's'} until moving day</p>`
          : days === 0 ? '<p class="g-days"><b>Today</b> is moving day! 🎉</p>' : '<p class="g-days">Moved in. Welcome home! 🏡</p>'}
        ${isExplorer() ? '' : `<label class="field"><span>Moving day</span><input type="date" value="${esc(f.moveDate)}" data-g-in="movedate"></label>`}</div>
    </section>`;
  }

  // ---------- solo: shortlist / advisors / taste ----------
  function soloRow(l) {
    const s = soloSw(l.id);
    const adv = advisorTally(l.id);
    const lc = lifeChecks(l);
    return `<button class="g-row" data-g="sheet" data-val="details" data-id="${l.id}">
      <span class="g-row-photo">${photoTag(l, 0)}${s.re === 'yes' ? '<span class="g-kids">Sure thing</span>' : ''}</span>
      <span class="g-row-body"><b>${money(l.price)} · ${esc(l.hood)}</b>
        <span class="muted">${esc(l.address)} · ${l.beds} bd · ${money(lc.pay.total)}/mo${lc.ratio != null ? ` · ${Math.round(lc.ratio * 100)}% of income` : ''}</span>
        ${adv.length ? `<span class="g-votes">${adv.map(([a, v]) => `<span class="g-vote ${v.v === 'yes' ? 'yes' : v.v === 'no' ? 'no' : 'wait'}" title="${esc(a.name)}">${av(a, 'xs')}${v.v === 'yes' ? '👍' : v.v === 'no' ? '👎' : '🤔'}</span>`).join('')}</span>` : ''}
      </span></button>`;
  }
  function shortlistView() {
    const sure = soloSure();
    const waiting = soloLiked().filter((l) => !soloSw(l.id).re);
    return `<div class="page-head"><div><div class="eyebrow">Shortlist</div><h1>${sure.length ? `${plural(sure.length, 'sure thing')}` : 'No sure things yet'}</h1></div>
      ${sure.length + waiting.length >= 2 ? `<button class="btn primary small" data-g="view" data-val="bracket">${icon('trophy')}Bracket</button>` : ''}</div>
      <p class="muted g-sub">A home becomes a sure thing when you like it twice, a few swipes apart. That filters out the "ooh, shiny" likes.</p>
      ${sure.length ? `<div class="map g-map" data-gmap="list"></div><div class="g-list">${sure.map(soloRow).join('')}</div>` : ''}
      ${waiting.length ? `<h3 class="sec-title">Liked once <span class="hint-inline">waiting for a second look</span></h3>
        <button class="pill-btn g-inline-btn" data-g="recheck-all">${icon('undo')}Give them a second look now</button>
        <div class="g-list">${waiting.map(soloRow).join('')}</div>` : ''}
      ${!sure.length && !waiting.length ? `<div class="empty g-empty"><p>Like a few homes in Discover. They'll come back later for a second look.</p><button class="btn primary" data-g="view" data-val="discover">Start swiping</button></div>` : ''}`;
  }
  function advisorsView() {
    const s = S();
    const list = soloLiked();
    return `<div class="page-head"><div><div class="eyebrow">Advisors</div><h1>Your second opinions</h1></div>
      <button class="btn primary small" data-g="sheet" data-val="add-advisor">+ Invite</button></div>
      <p class="muted g-sub">Invite a parent, friend or agent. They see only the homes you liked and vote 👍 🤔 👎 with a note. You always have the final say.</p>
      ${s.advisors.length ? `<div class="g-cards">${s.advisors.map((a) => {
        const votes = Object.values(a.votes || {});
        return `<section class="g-panel g-advisor">${av(a, '')}<div><b>${esc(a.name)}</b><span class="muted"> · ${esc(a.relation)}</span>
          <p class="small muted">${votes.length ? `Weighed in on ${plural(votes.length, 'home')}: ${votes.filter((v) => v.v === 'yes').length} 👍 ${votes.filter((v) => v.v === 'maybe').length} 🤔 ${votes.filter((v) => v.v === 'no').length} 👎` : 'Hasn\'t weighed in yet'}</p></div>
          <div class="g-adv-btns"><button class="btn small primary" data-g="advisor-on" data-id="${a.id}" ${list.length ? '' : 'disabled'}>Hand the device to ${esc(a.name)}</button>
          <button class="btn small ghost" data-g="advisor-link" data-id="${a.id}">${icon('share')}Send link</button>
          <button class="link muted" data-g="advisor-remove" data-id="${a.id}">Remove</button></div></section>`;
      }).join('')}</div>` : `<div class="empty g-empty"><div class="empty-ic">${icon('user')}</div><p>Most first-time buyers lean on someone. Add them here so their input lives next to the homes.</p><button class="btn primary" data-g="sheet" data-val="add-advisor">Invite an advisor</button></div>`}
      ${s.advisors.length && list.length ? `<h3 class="sec-title">What they said</h3><div class="g-list">${list.filter((l) => advisorTally(l.id).length).map(soloRow).join('') || '<p class="muted">No votes yet.</p>'}</div>` : ''}`;
  }
  function advisorMode() {
    const s = S();
    const a = s.advisors.find((x) => x.id === s.advisorOn);
    if (!a) { s.advisorOn = null; return ''; }
    const list = soloLiked();
    return `<div class="setup g-advisor-mode">
      <div class="handoff-note">${icon('user')} ${esc(a.name)} is reviewing</div>
      <h1>Hi ${esc(a.name)}! What do you think?</h1>
      <p class="lede">${esc(s.name)} liked these homes and wants your honest take. ${esc(s.name)} won't see your votes until you're done.</p>
      ${list.map((l) => {
        const v = (a.votes || {})[l.id] || {};
        return `<section class="g-adv-home">
          <button class="g-adv-photo" data-g="sheet" data-val="details" data-id="${l.id}">${photoTag(l, 0)}</button>
          <div class="g-adv-body"><b>${money(l.price)} · ${esc(l.hood)}</b><span class="muted small">${esc(l.address)} · ${l.beds} bd · ${l.baths} ba · ${money(gPayment(l).total)}/mo</span>
          <div class="seg">${[['yes', '👍 Go for it'], ['maybe', '🤔 Not sure'], ['no', '👎 Pass']].map(([k, label]) => `<button class="${v.v === k ? 'on' : ''}" data-g="adv-vote" data-id="${l.id}" data-val="${k}">${label}</button>`).join('')}</div>
          <input class="g-note-in" type="text" maxlength="120" placeholder="Add a note (optional)" value="${esc(v.note || '')}" data-g-in="adv-note" data-id="${l.id}"></div>
        </section>`;
      }).join('')}
      <button class="btn primary" data-g="advisor-off">Done, hand it back to ${esc(s.name)}</button>
    </div>`;
  }
  function tasteView() {
    const t = soloTaste();
    const traits = tasteTraits(t);
    const pct = tastePct(t, gPool());
    const picks = Object.entries(pct).filter(([id]) => !soloSw(id)).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return `<div class="page-head"><div><div class="eyebrow">For you</div><h1>${t.n >= 4 ? 'Here\'s your taste' : 'Still learning your taste'}</h1></div></div>
      ${t.n < 4 ? `<div class="empty g-empty"><div class="empty-ic">${icon('sparkle')}</div><p>Swipe ${4 - t.n} more home${4 - t.n === 1 ? '' : 's'} and NestMatch starts acting like a second swiper, sorting homes by what you actually pick.</p><button class="btn primary" data-g="view" data-val="discover">Keep swiping</button></div>` : `
      <section class="g-panel"><h3>What we noticed</h3>
        ${traits.loves.length ? `<p>You keep liking <b>${listJoin(traits.loves)}</b>.</p>` : ''}
        ${traits.skips.length ? `<p class="muted">You usually skip ${listJoin(traits.skips)}.</p>` : ''}
        ${t.avgPrice ? `<p class="muted">The homes you like average <b>${shortMoney(t.avgPrice)}</b>.</p>` : ''}
        <p class="fine">Based on ${plural(t.n, 'swipe')}. Your Discover deck is already sorted this way.</p></section>
      <h3 class="sec-title">Homes we think you'll love</h3>
      <div class="g-list">${picks.map(([id, p]) => { const l = byId(id); return `<button class="g-row" data-g="sheet" data-val="details" data-id="${id}"><span class="g-row-photo">${photoTag(l, 0)}<span class="g-kids">${p}% your taste</span></span><span class="g-row-body"><b>${money(l.price)} · ${esc(l.hood)}</b><span class="muted">${esc(l.address)} · ${l.beds} bd · ${l.features.slice(0, 3).map(esc).join(', ')}</span></span></button>`; }).join('') || '<p class="muted">You\'ve swiped every home that fits.</p>'}</div>`}`;
  }

  // ---------- bracket (family Final Round + solo bracket) ----------
  function bracketPool() {
    if (G.mode === 'family') return famMatches().map((l) => l.id);
    const sure = soloSure().map((l) => l.id);
    return (sure.length >= 2 ? sure : soloLiked().map((l) => l.id));
  }
  function startBracket() {
    const ids = bracketPool().slice(0, 8);
    if (ids.length < 2) return;
    const o = G.mode === 'family' ? F() : S();
    o.bracket = { round: 0, rounds: [pairUp(ids)], m: 0, votes: {}, voter: 0 };
    o.winner = null;
    gSave(); rerender();
  }
  function pairUp(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 2) out.push(ids[i + 1] ? [ids[i], ids[i + 1]] : [ids[i]]);
    return out;
  }
  const voters = () => (G.mode === 'family' ? F().members : [{ id: 'solo', name: S().name, color: 0, role: 'decider' }]);
  function bracketView() {
    const o = G.mode === 'family' ? F() : S();
    const fam = G.mode === 'family';
    const b = o.bracket;
    if (o.winner && byId(o.winner)) return winnerView();
    if (!b) {
      const n = bracketPool().length;
      return `<div class="page-head"><div><div class="eyebrow">${fam ? 'Final Round' : 'Bracket'}</div><h1>${n >= 2 ? `${plural(Math.min(n, 8), 'home')} go head to head` : 'Not enough homes yet'}</h1></div></div>
        <div class="empty g-empty"><div class="empty-ic">${icon('trophy')}</div>
        <p>${n >= 2 ? (fam ? `Two homes at a time, everyone votes in secret, and ${RULES[o.rule].label.toLowerCase()} decides who moves on. Last home standing wins.${n > 8 ? ' Your top 8 matches play.' : ''}` : `Your ${soloSure().length >= 2 ? 'sure things' : 'liked homes'} face off two at a time until one is left.${n > 8 ? ' Your top 8 play.' : ''}`) : fam ? 'You need at least 2 matches.' : 'Like at least 2 homes first.'}</p>
        ${n >= 2 ? `<button class="btn primary" data-g="bracket-start">${icon('trophy')}Start</button>` : `<button class="btn primary" data-g="view" data-val="discover">Keep swiping</button>`}</div>`;
    }
    if (!checkBracket(o)) return bracketView();
    const pair = b.rounds[b.round][b.m];
    const vs = voters();
    const v = vs[b.voter];
    const roundName = (r) => { const left = b.rounds[r].reduce((a, p) => a + p.length, 0); return left === 2 ? 'Final' : left <= 4 ? 'Semifinal' : `Round ${r + 1}`; };
    const card = (id) => {
      const l = byId(id);
      const adv = !fam ? advisorTally(id) : [];
      const kid = fam && v.role === 'explorer';
      return `<button class="vcard g-vcard" data-g="bracket-vote" data-id="${id}">
        <div class="vphoto">${photoTag(l, 0)}</div>
        <div class="vbody"><div class="vprice">${kid ? `${l.beds} bedrooms` : money(l.price)}</div><div class="muted small">${kid ? esc(l.hood) : `${esc(l.address)} · ${esc(l.hood)}`}</div>
          ${kid ? '' : `<div class="muted small">${l.beds} bd · ${l.baths} ba · ${num(l.sqft)} sqft · ${money(gPayment(l).total)}/mo</div>`}
          ${adv.length ? `<div class="g-votes">${adv.map(([a, x]) => `<span class="g-vote ${x.v === 'yes' ? 'yes' : x.v === 'no' ? 'no' : 'wait'}">${av(a, 'xs')}${x.v === 'yes' ? '👍' : x.v === 'no' ? '👎' : '🤔'}</span>`).join('')}</div>` : ''}
          <span class="btn primary small">Pick this one</span></div></button>`;
    };
    if (fam && F().active !== v.id) { // the device is still with the last voter: don't show anything until it's handed over
      return `<div class="page-head"><div><div class="eyebrow">Final Round · ${roundName(b.round)}</div><h1>${esc(v.name)}'s turn</h1></div></div>
        <div class="empty g-empty"><div class="handoff-avatars">${av(activeM())}${icon('right')}${av(v)}</div>
        <p>Pass the device to ${esc(v.name)}. Votes stay secret until everyone has picked.</p>
        <button class="btn primary g-ellipsis" data-g="be" data-id="${v.id}">I'm ${esc(v.name)}</button></div>`;
    }
    return `<div class="page-head"><div><div class="eyebrow">${fam ? 'Final Round' : 'Bracket'} · ${roundName(b.round)} · match ${b.m + 1} of ${b.rounds[b.round].length}</div>
      <h1>${fam ? `${esc(v.name)}, which one?` : 'Which one would you rather live in?'}</h1></div>
      ${canReset() ? '<button class="link" data-g="bracket-reset">Start over</button>' : ''}</div>
      ${fam ? `<div class="g-turns">${vs.map((m, i) => `<span class="g-dot${i < b.voter ? ' in' : ''}${i === b.voter ? ' now' : ''}">${av(m, 'xs')}</span>`).join('')}<span class="muted small">${`${b.voter} of ${vs.length} voted`}</span></div>` : ''}
      <div class="versus g-versus">${card(pair[0])}<div class="vs">VS</div>${card(pair[1])}</div>
      ${fam ? '<p class="fine">Votes are secret until everyone has picked. Pass the device after you vote.</p>' : ''}`;
  }
  const canReset = () => G.mode === 'solo' || activeM().role === 'decider';
  // Fix up a bracket whose homes or voters changed (member removed, data reloaded). Returns false if it was reset.
  function checkBracket(o) {
    const b = o.bracket;
    if (!b) return true;
    const ids = b.rounds[b.round].flat();
    if (ids.some((x) => !byId(x))) { o.bracket = null; gSave(); toast('Some homes left the Final Round, so it was reset'); return false; }
    if (b.voter >= voters().length || Object.keys(b.votes).some((k) => !voters().some((v) => v.id === k))) { b.votes = {}; b.voter = 0; gSave(); }
    return true;
  }
  function bracketVote(id) {
    const o = G.mode === 'family' ? F() : S();
    const b = o.bracket;
    if (!b || !checkBracket(o)) return rerender();
    const vs = voters();
    if (!b.rounds[b.round][b.m].includes(id)) return;
    b.votes[vs[b.voter].id] = id;
    if (b.voter < vs.length - 1) {
      b.voter += 1;
      gSave();
      if (G.mode === 'family') openSheet('pass', vs[b.voter].id); // 'be' makes them the active member
      rerender();
      return;
    }
    // everyone voted: count with the family's rule, ties go to everyone's votes, then a coin flip
    const pair = b.rounds[b.round][b.m];
    const score = (pid, w) => vs.reduce((a, m) => a + (b.votes[m.id] === pid ? w(m) : 0), 0);
    let win = null; let how = '';
    const s0 = score(pair[0], G.mode === 'family' ? weight : () => 1); const s1 = score(pair[1], G.mode === 'family' ? weight : () => 1);
    if (s0 !== s1) win = s0 > s1 ? pair[0] : pair[1];
    else {
      const r0 = score(pair[0], () => 1); const r1 = score(pair[1], () => 1);
      if (r0 !== r1) { win = r0 > r1 ? pair[0] : pair[1]; how = 'Tie broken by everyone\'s votes.'; } else { win = pair[Math.random() < 0.5 ? 0 : 1]; how = 'A perfect tie, so a coin flip decided.'; }
    }
    const tallyLine = G.mode === 'family' ? vs.map((m) => `${esc(m.name)}: ${b.votes[m.id] === pair[0] ? esc(byId(pair[0]).hood) : esc(byId(pair[1]).hood)}`).join(' · ') : '';
    b.results = b.results || [];
    b.results.push({ pair, win, votes: { ...b.votes } });
    b.votes = {}; b.voter = 0; // the next matchup starts with vs[0]; the view asks for a hand-off first
    const rd = b.rounds[b.round];
    rd[b.m] = [win]; // winner stays in the slot
    b.m += 1;
    while (b.m < rd.length && rd[b.m].length === 1) b.m += 1; // byes go straight through
    if (b.m >= rd.length) {
      const next = rd.map((p) => p[0]);
      if (next.length === 1) { o.winner = next[0]; o.bracket = null; gSave(); rerender(); confetti(true); return; }
      b.rounds.push(pairUp(next)); b.round += 1; b.m = 0;
      while (b.m < b.rounds[b.round].length && b.rounds[b.round][b.m].length === 1) b.m += 1;
    }
    gSave(); rerender();
    if (G.mode === 'family') openSheet('reveal', { win, tallyLine, how });
    else toast(`${esc(byId(win).hood)} moves on.${how ? ` ${how}` : ''}`);
  }
  function winnerView() {
    const fam = G.mode === 'family';
    const o = fam ? F() : S();
    const l = byId(o.winner);
    const kid = isExplorer();
    return `<div class="winner g-winner">
      <div class="w-photo">${photoTag(l, 0)}<span class="w-badge">${icon('trophy')}${fam ? 'The family pick' : 'Your pick'}</span></div>
      <div class="w-body">
        <div class="eyebrow">${fam ? `${esc(o.name)} found the one` : 'You found the one'}</div>
        <h1>${kid ? `Our new house in ${esc(l.hood)}!` : esc(l.address)}</h1>
        ${kid ? '' : `<p class="muted">${money(l.price)} · ${l.beds} bd · ${l.baths} ba · ${esc(l.hood)} · ${money(gPayment(l).total)}/mo est.</p>`}
        ${fam ? moveCountdown() : ''}
        ${kid ? '' : `<div class="g-next">
          <button class="btn primary" data-g="cta" data-val="Tour request (demo, so nothing was sent)">${icon('calendar')}Request a tour</button>
          <button class="btn ghost" data-g="cta" data-val="Pre-approval (demo, so nothing was sent)">${icon('wallet')}Get pre-approved</button>
          ${fam ? '' : (S().advisors.length ? `<button class="btn ghost" data-g="cta" data-val="Shared with your advisors (demo)">${icon('share')}Share with my advisors</button>` : '')}
        </div>`}
        ${canReset() ? '<button class="link" data-g="bracket-reset">Run it again</button>' : ''}
      </div></div>`;
  }

  // ---------- sheets ----------
  function detailsSheet(id) {
    const l = byId(id);
    if (!l) return '';
    const kid = isExplorer();
    const pay = gPayment(l);
    const fam = G.mode === 'family';
    const me = fam ? activeM() : null;
    const myRoom = fam ? (F().rooms[me.id] || {})[l.id] : null;
    const onTop = (fam ? (famDeck(F().active)[0] || {}).id : (!soloDue().length && (soloDeck()[0] || {}).id)) === id
      && ((fam ? F().view : S().view) === 'discover');
    const row = (label, value) => `<div class="kv"><span>${label}</span><b>${value}</b></div>`;
    let extra = '';
    if (fam && !kid) {
      const D = F().members.filter((m) => m.role === 'decider' && WORK_HUBS[m.work]);
      extra += `<section class="d-sec"><h3>Family votes</h3>${voteChips(l)}<p class="fine">You see others' picks after you swipe a home yourself.</p></section>`;
      extra += `<section class="d-sec"><h3>Commutes</h3>${D.map((m) => { const c = hubCommute(l, m.work); return `<div class="commute">${av(m, 'sm')}<span>${esc(m.name)}</span><b>${c == null ? 'Works from home' : `${c} min`}</b><span class="muted">${c == null ? '' : `to ${esc(WORK_HUBS[m.work].name)}`}</span></div>`; }).join('')}</section>`;
      const rooms = F().members.filter((m) => (F().rooms[m.id] || {})[l.id] != null);
      if (rooms.length) extra += `<section class="d-sec"><h3>Rooms claimed</h3><div class="g-mini">${rooms.map((m) => `<span class="g-mini-home">${photoTag(l, F().rooms[m.id][l.id])}<span>${av(m, 'xs')} ${esc(m.name)}'s room</span></span>`).join('')}</div></section>`;
    }
    if (!fam && !S().advisorOn) { // an advisor reviewing on your device never sees your income
      const lc = lifeChecks(l);
      const s = S();
      const band = lc.ratio == null ? null : lc.ratio <= 0.28 ? ['ok', 'Comfortable'] : lc.ratio <= 0.36 ? ['mid', 'A stretch'] : ['bad', 'Risky on one income'];
      const adv = advisorTally(l.id);
      extra += `<section class="d-sec"><h3>Solo life checks</h3>
        ${band ? `<div class="g-check ${band[0]}"><b>${band[1]}</b><span>${money(pay.total)}/mo is ${Math.round(lc.ratio * 100)}% of your ${money(s.income / 12)} monthly income. Lenders like 28% or less.</span></div>` : '<p class="muted small">Add your income in Settings to see if this works on one paycheck.</p>'}
        ${lc.commute != null ? row('Your commute', `${lc.commute} min to ${esc(WORK_HUBS[s.work].name)}`) : ''}
        ${lc.value != null ? row('Price per sqft', `${money(lc.ppsf)} <span class="muted">· ${lc.value > 2 ? `${lc.value}% below` : lc.value < -2 ? `${-lc.value}% above` : 'about the same as'} the ${esc(l.hood)} average</span>`) : ''}
        ${lc.safety ? row('Neighborhood score', `${lc.safety}/10 <span class="muted">· demo number, not real crime data</span>`) : ''}
        ${s.househack && lc.rooms ? `<div class="g-check ok"><b>House hack: ${money(lc.afterRent)}/mo</b><span>Rent ${plural(lc.rooms, 'spare room')} at about ${money(lc.roomRent)} each and your cost drops from ${money(pay.total)}. Rough estimate.</span></div>` : ''}
      </section>`;
      if (adv.length) extra += `<section class="d-sec"><h3>Advisors</h3>${adv.map(([a, v]) => `<div class="g-wish">${av(a, 'sm')}<span><b>${esc(a.name)}</b> ${v.v === 'yes' ? '👍 says go for it' : v.v === 'no' ? '👎 would pass' : '🤔 isn\'t sure'}${v.note ? `: "${esc(v.note)}"` : ''}</span></div>`).join('')}</section>`;
    }
    const gallery = l.photos.map((_, i) => `<div class="g-shot">${photoTag(l, i)}${fam ? `<button class="g-room-btn${String(myRoom) === String(i) ? ' on' : ''}" data-g="room" data-id="${l.id}" data-val="${i}">${String(myRoom) === String(i) ? `${icon('check')}My room` : 'This is my room!'}</button>` : ''}</div>`).join('');
    const swipeBtns = onTop ? (kid ? `<div class="d-actions g-kid-actions"><button class="btn ghost" data-g="sheet-swipe" data-val="pass">👎 Nope</button><button class="btn ghost" data-g="sheet-swipe" data-val="love">😍 Love</button><button class="btn primary" data-g="sheet-swipe" data-val="like">👍 Like</button></div>`
      : `<div class="d-actions"><button class="btn ghost" data-g="sheet-swipe" data-val="pass">${icon('x')}Pass</button><button class="btn ghost love" data-g="sheet-swipe" data-val="love">${icon('star')}Love</button><button class="btn primary" data-g="sheet-swipe" data-val="like">${icon('heart')}Like</button></div>`) : '';
    return `<div class="details">
      <button class="icon-btn close" data-g="close" aria-label="Close">${icon('x')}</button>
      <div class="gallery g-gallery">${gallery}</div>
      ${l.photos.length > 1 ? `<div class="gallery-hint">${l.photos.length} photos · scroll →${fam ? ' · tap "This is my room!" on your favorite' : ''}</div>` : ''}
      <div class="d-head"><div>
        ${kid ? `<div class="d-price">${l.beds} bedrooms in ${esc(l.hood)}</div><div class="d-addr">${gVibe(l) ? esc(gVibe(l)) : esc(l.style)}</div>`
          : `<div class="d-price">${money(l.price)}${l.originalPrice > l.price ? `<span class="was">${money(l.originalPrice)}</span>` : ''}</div><div class="d-addr">${esc(l.address)}, ${esc(l.city)}, ${esc(l.state)} ${esc(l.zip || '')}</div>`}
      </div></div>
      <div class="facts-row big"><span>${icon('bed')}<b>${l.beds}</b> beds</span><span>${icon('bath')}<b>${l.baths}</b> baths</span>${kid ? '' : `<span>${icon('area')}<b>${num(l.sqft)}</b> sqft</span>`}</div>
      ${kid ? `<section class="d-sec"><h3>Cool stuff here</h3>${l.features.length ? `<div class="feature-list">${l.features.map((f) => `<span>${icon('check')}${esc((KID_FEATURES.find(([k]) => k === f) || [f, f])[1])}</span>`).join('')}</div>` : '<p class="muted">A cozy, simple house.</p>'}</section>` : `
      <section class="d-sec"><h3>Monthly cost</h3><div class="pay-total"><b>${money(pay.total)}</b><span>/mo estimated</span></div>
        <p class="fine">30-year fixed, ${MFin().down}% down at ${MFin().rate}%. Principal & interest ${money(pay.pi)}, tax ${money(pay.tax)}, insurance${pay.pmi ? ' & PMI' : ''} ${money(pay.ins + pay.pmi)}${pay.hoa ? `, HOA ${money(pay.hoa)}` : ''}.</p></section>
      ${extra}
      <section class="d-sec"><h3>About this home</h3><p>${esc(l.description)}</p>${l.features.length ? `<div class="feature-list">${l.features.map((f) => `<span>${icon('check')}${esc(f)}</span>`).join('')}</div>` : ''}</section>
      <section class="d-sec grid2">${row('Style', esc(l.style))}${row('Year built', l.year || '—')}${row('HOA', l.hoa ? `${money(l.hoa)}/mo` : 'None')}${row('Schools', l.school ? `${l.school}/10` : '—')}${row('Flood risk', l.flood || '—')}${row('On market', l.dom != null ? `${l.dom} days` : '—')}</section>`}
      ${l.lat != null ? `<section class="d-sec"><h3>${kid ? 'Where it is' : 'Location'}</h3><div class="map small" data-gmap="one" data-id="${l.id}"></div></section>` : ''}
      ${kid ? '' : `<p class="fine listed">Listed by ${esc(l.office)}.${l.source === 'sample' ? ' Sample listing for demo purposes; not a real home for sale.' : ''}</p>`}
      ${swipeBtns}
    </div>`;
  }
  function whoSheet() {
    const f = F();
    return `<div class="sheet-head"><h2>Who's using the app?</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
      <p class="muted">Pass the device around. Swipes stay private until you've each seen a home.</p>
      <div class="g-who-list">${f.members.map((m) => `<button class="g-who${m.id === f.active ? ' on' : ''}" data-g="be" data-id="${m.id}">${av(m)}<span><b>${esc(m.name)}</b><span class="muted small">${ROLES[m.role].label} · ${famDeck(m.id).length} left${openPollsFor(m.id) ? ` · ${plural(openPollsFor(m.id), 'poll')}` : ''}</span></span>${m.id === f.active ? icon('check') : ''}</button>`).join('')}</div>`;
  }
  function passSheet(id) {
    const m = mById(id);
    return `<div class="handoff"><div class="handoff-avatars">${av(activeM())}${icon('right')}${av(m)}</div>
      <h2>Pass the device to ${esc(m.name)}</h2><p class="muted">Votes stay secret until everyone has voted.</p>
      <button class="btn primary g-ellipsis" data-g="be" data-id="${m.id}">I'm ${esc(m.name)}</button></div>`;
  }
  function matchSheetG(id) {
    const l = byId(id);
    const ms = F().members;
    return `<div class="match">
      <div class="match-photo">${photoTag(l, 0)}<div class="match-avatars g-match-avs">${ms.filter((m) => isLikeV(famSwipe(m.id, id))).map((m) => av(m)).join('')}</div></div>
      <div class="match-title">It's a family match!</div>
      <p>${esc(F().name)} agrees on <b>${isExplorer() ? `the ${l.beds}-bedroom house in ${esc(l.hood)}` : esc(l.address)}</b>.</p>
      <p class="muted small">Counted with "${esc(RULES[F().rule].label)}".</p>
      <div class="two"><button class="btn ghost" data-g="close">Keep swiping</button><button class="btn primary" data-g="goto" data-val="matches">View ${isExplorer() ? 'our list' : 'matches'}</button></div>
    </div>`;
  }
  function revealSheet(arg) {
    const l = byId(arg.win);
    return `<div class="handoff"><div class="g-reveal-photo">${photoTag(l, 0)}</div>
      <h2>${esc(l.hood)} moves on!</h2>
      <p class="muted small">${arg.tallyLine}</p>${arg.how ? `<p class="muted small">${esc(arg.how)}</p>` : ''}
      <button class="btn primary" data-g="close">Next matchup</button></div>`;
  }
  function settingsSheet() {
    if (G.mode === 'solo') {
      const s = S();
      return `<div class="sheet-head"><h2>Settings</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
        <label class="field"><span>Yearly income</span><input type="number" min="0" step="1000" value="${s.income || ''}" data-g-in="income"></label>
        <label class="toggle"><input type="checkbox" data-g="househack" ${s.househack ? 'checked' : ''}><span>Show house-hack estimates</span></label>
        <div class="group"><div class="label">Where do you work?</div><div class="seg">${Object.keys(WORK_HUBS).map((k) => `<button class="${s.work === k ? 'on' : ''}" data-g="swork" data-val="${k}">${esc(WORK_HUBS[k].name)}</button>`).join('')}</div></div>
        <div class="group"><div class="label">Dealbreakers</div><div class="picks">${Object.keys(DEALBREAKERS).map((d) => `<button class="pick${s.dealbreakers.includes(d) ? ' on' : ''}" data-g="sdeal" data-val="${esc(d)}">${esc(d)}</button>`).join('')}</div></div>
        <div class="sheet-sec"><button class="btn ghost" data-g="reset-mode">Start solo mode over</button></div>`;
    }
    const f = F();
    const isDecider = activeM().role === 'decider';
    return `<div class="sheet-head"><h2>Family settings</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
      ${isDecider ? '' : '<p class="g-note">Only Deciders can change these.</p>'}
      <div class="group"><div class="label">How you decide</div><div class="g-rules">${Object.entries(RULES).map(([k, r]) => `<button class="g-rule${f.rule === k ? ' on' : ''}" data-g="rule" data-val="${k}" ${isDecider ? '' : 'disabled'}><b>${r.label}</b><span>${r.blurb}</span></button>`).join('')}</div></div>
      <div class="group"><div class="label">Roles</div>${f.members.map((m) => `<div class="g-member compact">${av(m, 'sm')}<span class="g-mname">${esc(m.name)}</span><div class="seg g-roles">${Object.keys(ROLES).map((r) => `<button class="${m.role === r ? 'on' : ''}" data-g="mrole" data-id="${m.id}" data-val="${r}" ${isDecider ? '' : 'disabled'}>${ROLES[r].label}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="group"><div class="label">Family dealbreakers</div><div class="picks">${Object.keys(DEALBREAKERS).map((d) => `<button class="pick${f.dealbreakers.includes(d) ? ' on' : ''}" data-g="fdeal" data-val="${esc(d)}" ${isDecider ? '' : 'disabled'}>${esc(d)}</button>`).join('')}</div></div>
      ${isDecider ? '<div class="sheet-sec two"><button class="btn ghost" data-g="fam-edit">Edit members</button><button class="btn ghost" data-g="reset-mode">Start family mode over</button></div>' : ''}`;
  }
  function addAdvisorSheet() {
    return `<div class="sheet-head"><h2>Invite an advisor</h2><button class="icon-btn" data-g="close" aria-label="Close">${icon('x')}</button></div>
      <label class="field"><span>Name</span><input id="g-adv-name" type="text" maxlength="20" placeholder="Mom, Jordan, ..."></label>
      <div class="group"><div class="label">Who are they?</div><div class="seg" id="g-adv-rel">${ADVISOR_RELATIONS.map((r, i) => `<button class="${i === 0 ? 'on' : ''}" data-g="adv-rel" data-val="${r}">${r}</button>`).join('')}</div></div>
      <p class="fine">They'll only see homes you liked. In this demo they review on your device; the real app would send them a link.</p>
      <div class="two sticky-actions"><button class="btn ghost" data-g="close">Cancel</button><button class="btn primary" data-g="advisor-add">Add advisor</button></div>`;
  }
  const SHEETS = { filters: filtersSheet, details: detailsSheet, who: whoSheet, pass: passSheet, match: matchSheetG, reveal: revealSheet, settings: settingsSheet, 'new-poll': newPollSheet, 'add-advisor': addAdvisorSheet };
  const CENTER = ['pass', 'match', 'reveal'];
  function overlayEl() {
    let o = document.getElementById('g-overlay');
    if (!o) { o = document.createElement('div'); o.id = 'g-overlay'; o.hidden = true; document.body.appendChild(o); }
    return o;
  }
  function openSheet(name, arg) { gSheet = { name, arg }; drawSheet(false); }
  function drawSheet(keep) {
    const o = overlayEl();
    const prev = o.querySelector('.sheet');
    const top = keep && prev ? prev.scrollTop : 0;
    const center = CENTER.includes(gSheet.name);
    o.innerHTML = `<div class="sheet ${center ? 'center' : ''} sheet-${gSheet.name === 'details' ? 'details' : `g-${gSheet.name}`}" role="dialog" aria-modal="true">${SHEETS[gSheet.name](gSheet.arg)}</div>`;
    o.hidden = false;
    o.classList.toggle('centered', center);
    o.querySelector('.sheet').scrollTop = top;
    mountGMaps(o);
  }
  function closeSheet() { gSheet = null; const o = overlayEl(); o.hidden = true; o.innerHTML = ''; }

  // ---------- maps ----------
  function mountGMaps(root) {
    if (!window.L) return;
    root.querySelectorAll('[data-gmap]').forEach((el) => {
      if (el._g) return;
      el._g = true;
      const map = L.map(el, { zoomControl: el.dataset.gmap !== 'one', scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19 }).addTo(map);
      const pin = (l) => L.marker([l.lat, l.lng], { icon: L.divIcon({ className: '', html: `<div class="map-pin match">${isExplorer() ? `${l.beds}bd` : shortMoney(l.price)}</div>`, iconSize: null }) });
      if (el.dataset.gmap === 'one') {
        const l = byId(el.dataset.id);
        map.setView([l.lat, l.lng], 13);
        pin(l).addTo(map);
      } else {
        const homes = (G.mode === 'family' ? famMatches() : soloSure()).filter((l) => l.lat != null);
        homes.forEach((l) => pin(l).on('click', () => openSheet('details', l.id)).addTo(map));
        if (homes.length) map.fitBounds(homes.map((l) => [l.lat, l.lng]), { padding: [40, 40], maxZoom: 13 });
        else map.setView([42.48, -83.2], 10);
      }
      gMaps.push(map);
      setTimeout(() => { if (map.getContainer().isConnected) map.invalidateSize(); }, 60);
    });
  }

  // ---------- events ----------
  function setView(v) {
    const o = G.mode === 'family' ? F() : S();
    o.view = v; closeSheet(); gSave(); rerender();
    const main = document.querySelector('.main'); if (main) main.scrollTop = 0;
  }
  function toggle(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  function onClick(e) {
    const el = e.target.closest('[data-g]');
    if (!el) { if (e.target.id === 'g-overlay') closeSheet(); return; }
    if (el.tagName === 'INPUT' && el.type !== 'checkbox') return;
    const { g, id, val } = el.dataset;
    const f = F(); const s = S();
    const refresh = () => { gSave(); if (gSheet) drawSheet(true); rerender(); };
    switch (g) {
      case 'change-mode': {
        picking = true; closeSheet();
        const appOverlay = document.getElementById('overlay'); // app.js's sheet (e.g. Preferences), if it's open
        if (appOverlay && !appOverlay.hidden && typeof window.closeSheet === 'function') window.closeSheet();
        rerender(); break;
      }
      case 'pick-cancel': picking = false; rerender(); break;
      case 'pick-mode': {
        picking = false;
        G.mode = val; gSave();
        rerender();
        const main = document.querySelector('.main'); if (main) main.scrollTop = 0;
        break;
      }
      // family setup
      case 'madd': {
        if (f.members.length >= 8) break;
        let n = f.members.length + 1;
        while (f.members.some((m) => m.name.toLowerCase() === `person ${n}`)) n += 1;
        const used = f.members.map((m) => m.color);
        const color = [...Array(COLORS).keys()].find((c) => !used.includes(c)) ?? 0;
        f.members.push(member(`Person ${n}`, 'voice', color));
        if (f.bracket) { f.bracket.votes = {}; f.bracket.voter = 0; }
        refresh(); break;
      }
      case 'mremove':
        if (f.members.length > 3) {
          f.members = f.members.filter((m) => m.id !== id);
          if (!mById(f.active)) f.active = f.members[0].id;
          if (f.bracket) { f.bracket.votes = {}; f.bracket.voter = 0; }
        }
        refresh(); break;
      case 'mrole': {
        const m = mById(id);
        if (m.role === 'decider' && val !== 'decider' && f.members.filter((x) => x.role === 'decider').length === 1) return toast('Keep at least one Decider');
        m.role = val; refresh(); break;
      }
      case 'mwork': mById(id).work = val; refresh(); break;
      case 'mcommute': mById(id).maxCommute = Number(val); refresh(); break;
      case 'rule': f.rule = val; refresh(); break;
      case 'fdeal': toggle(f.dealbreakers, val); refresh(); break;
      case 'fs-next': {
        if (f.step === 0) {
          const names = f.members.map((m) => m.name.trim().toLowerCase());
          if (names.some((n) => !n)) return toast('Give everyone a name');
          if (new Set(names).size !== names.length) return toast('Use different names so you can tell whose turn it is');
          if (!f.members.some((m) => m.role === 'decider')) return toast('Pick at least one Decider');
        }
        f.step += 1; refresh(); document.querySelector('.main').scrollTop = 0; break;
      }
      case 'fs-back': f.step = Math.max(0, f.step - 1); refresh(); break;
      case 'fs-done': f.done = true; f.view = 'discover'; f.active = (f.members.find((m) => m.role === 'decider') || f.members[0]).id; refresh(); break;
      case 'fam-edit': f.done = false; f.step = 0; closeSheet(); refresh(); break;
      // solo setup
      case 'swork': s.work = val; refresh(); break;
      case 'scommute': s.maxCommute = Number(val); refresh(); break;
      case 'sdeal': toggle(s.dealbreakers, val); refresh(); break;
      case 'snice': toggle(s.nice, val); refresh(); break;
      case 'househack': s.househack = el.checked; refresh(); break;
      case 'ss-next': if (!s.name.trim()) return toast('Add your name'); s.step += 1; refresh(); document.querySelector('.main').scrollTop = 0; break;
      case 'ss-back': s.step = Math.max(0, s.step - 1); refresh(); break;
      case 'ss-done': s.done = true; s.view = 'discover'; refresh(); break;
      case 'reset-mode':
        if (!confirm(`Start ${G.mode} mode over? This clears its swipes${G.mode === 'family' ? ', polls' : ', advisors'} and picks.`)) break;
        if (G.mode === 'family') G.family = defFamily(); else G.solo = defSolo();
        lastSwipe = null; closeSheet(); refresh(); break;
      case 'mode-repair':
        if (G.mode === 'family') G.family = defFamily(); else if (G.mode === 'solo') G.solo = defSolo(); else G = gDefault();
        picking = false; lastSwipe = null; gSave(); rerender(); break;
      // filters (this mode's own)
      case 'f-pick': { const k = el.dataset.key; if (FILTER_ARRAYS.includes(k)) toggle(MF()[k], String(val)); refresh(); break; }
      case 'f-flood': MF().hideHighFlood = el.checked; refresh(); break;
      case 'fin': if (['down', 'rate'].includes(el.dataset.key)) MFin()[el.dataset.key] = Number(val); refresh(); break;
      case 'f-clear': Object.assign(MF(), gFilterDefaults()); refresh(); break;
      // nav + sheets
      case 'view': setView(val); break;
      case 'goto': setView(val); break;
      case 'sheet': openSheet(val, id); break;
      case 'close': closeSheet(); break;
      case 'be': f.active = id; closeSheet(); lastSwipe = null; gSave(); rerender(); break;
      case 'handoff': openSheet('pass', id); break;
      case 'cta': toast(esc(val)); break;
      // swiping
      case 'swipe': gSwipe(val); break;
      case 'sheet-swipe': closeSheet(); setTimeout(() => gSwipe(val), 30); break;
      case 'undo': gUndo(); break;
      case 'recheck': gSwipe(val === 'yes' ? 'like' : 'pass'); break;
      case 'recheck-all': soloLiked().forEach((l) => { const x = soloSw(l.id); if (!x.re) x.n = -RECHECK_AFTER; }); s.view = 'discover'; refresh(); break;
      case 'room': {
        const r = (f.rooms[f.active] = f.rooms[f.active] || {});
        if (String(r[id]) === String(val)) delete r[id]; else { r[id] = Number(val); toast(isExplorer() ? 'Great choice! That\'s your room 🛏️' : 'Room claimed'); }
        refresh(); break;
      }
      case 'wish': toggle((f.wishlist[f.active] = f.wishlist[f.active] || []), val); refresh(); break;
      // polls
      case 'poll-vote': { const p = f.polls.find((x) => x.id === id); p.votes[f.active] = val; afterVote(p); break; }
      case 'rank-move': {
        const p = f.polls.find((x) => x.id === id);
        if (!pollDraft || pollDraft.rankFor !== id) pollDraft = { rankFor: id, order: p.options.map((o) => o.id) };
        const i = Number(val); const j = i + Number(el.dataset.dir);
        [pollDraft.order[i], pollDraft.order[j]] = [pollDraft.order[j], pollDraft.order[i]];
        rerender(); break;
      }
      case 'rank-submit': {
        const p = f.polls.find((x) => x.id === id);
        p.votes[f.active] = pollDraft && pollDraft.rankFor === id ? pollDraft.order.slice() : p.options.map((o) => o.id);
        pollDraft = null; afterVote(p); break;
      }
      case 'poll-close': f.polls.find((x) => x.id === id).closed = true; refresh(); break;
      case 'poll-delete': if (confirm('Delete this poll?')) { f.polls = f.polls.filter((x) => x.id !== id); refresh(); } break;
      case 'poll-preset': { const [q, opts] = POLL_PRESETS[Number(val)]; createPoll('feature', q, opts.map((label) => ({ label }))); refresh(); toast('Poll sent to the family'); break; }
      case 'poll-quick': {
        const m = famMatches();
        if (val === 'h2h') createPoll('h2h', 'Which of our top two?', m.slice(0, 2).map((l) => homeOpt(l.id)));
        else createPoll('rank', 'Rank our matches', m.slice(0, 5).map((l) => homeOpt(l.id)));
        setView('polls'); toast('Poll sent to the family'); break;
      }
      case 'poll-home': {
        e.stopPropagation();
        const l = byId(id);
        createPoll('feature', `Should ${l.address} get another chance?`, [{ label: 'Yes, keep it' }, { label: 'No, let it go' }]);
        closeSheet(); setView('polls'); toast('Poll sent to the family'); return;
      }
      case 'draft-type': pollDraft.type = val; pollDraft.homes = []; drawSheet(true); break;
      case 'draft-preset': { const [q, opts] = POLL_PRESETS[Number(val)]; pollDraft.q = q; pollDraft.options = opts.slice(); drawSheet(true); break; }
      case 'draft-addopt': pollDraft.options.push(''); drawSheet(true); break;
      case 'draft-home': {
        const max = pollDraft.type === 'h2h' ? 2 : 5;
        if (pollDraft.homes.includes(id)) pollDraft.homes = pollDraft.homes.filter((x) => x !== id);
        else if (pollDraft.homes.length < max) pollDraft.homes.push(id);
        else toast(`Pick up to ${max}`);
        drawSheet(true); break;
      }
      case 'poll-create': {
        const d = pollDraft;
        if (d.type === 'feature') {
          const opts = d.options.map((x) => x.trim()).filter(Boolean);
          if (!d.q.trim() || opts.length < 2) return toast('Add a question and at least 2 options');
          createPoll('feature', d.q.trim(), opts.map((label) => ({ label })));
        } else {
          const need = d.type === 'h2h' ? 2 : 3;
          if (d.homes.length < need) return toast(`Pick ${d.type === 'h2h' ? '2' : 'at least 3'} homes`);
          createPoll(d.type, d.type === 'h2h' ? 'Which home do you like more?' : 'Rank these homes', d.homes.map(homeOpt));
        }
        closeSheet(); setView('polls'); toast('Poll sent to the family'); break;
      }
      // advisors
      case 'adv-rel': el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); break;
      case 'advisor-add': {
        const name = (document.getElementById('g-adv-name').value || '').trim();
        if (!name) return toast('Add their name');
        const rel = (document.querySelector('#g-adv-rel .on') || {}).dataset?.val || 'Friend';
        s.advisors.push({ id: uid(), name, relation: rel, color: (s.advisors.length + 1) % COLORS, votes: {} });
        closeSheet(); refresh(); toast(`${esc(name)} added`); break;
      }
      case 'advisor-remove': if (confirm('Remove this advisor and their votes?')) { s.advisors = s.advisors.filter((a) => a.id !== id); refresh(); } break;
      case 'advisor-link': toast('In the real app this texts them a private link (demo, so nothing was sent)'); break;
      case 'advisor-on': s.advisorOn = id; refresh(); document.querySelector('.main').scrollTop = 0; break;
      case 'advisor-off': {
        const a = s.advisors.find((x) => x.id === s.advisorOn);
        s.advisorOn = null; refresh();
        if (a) toast(`Thanks, ${esc(a.name)}! Their votes are on your shortlist.`);
        break;
      }
      case 'adv-vote': { const a = s.advisors.find((x) => x.id === s.advisorOn); a.votes[id] = { ...(a.votes[id] || {}), v: val }; refresh(); break; }
      // bracket
      case 'bracket-start': startBracket(); break;
      case 'bracket-vote': bracketVote(id); break;
      case 'bracket-reset': { const o = G.mode === 'family' ? F() : S(); o.bracket = null; o.winner = null; refresh(); break; }
      default: break;
    }
  }
  function afterVote(p) {
    const f = F();
    gSave();
    const all = f.members.every((m) => p.votes[m.id] != null);
    rerender();
    if (all) { confetti(); toast('Everyone voted! Results are in.'); return; }
    const next = f.members.find((m) => p.votes[m.id] == null);
    toast(isExplorer() ? 'Vote counted! 🎉' : `Vote in. Waiting on ${esc(next.name)}${f.members.filter((m) => p.votes[m.id] == null).length > 1 ? ' and others' : ''}.`);
  }
  function onInput(e) {
    const el = e.target;
    const k = el.dataset.gIn;
    if (!k) return;
    const f = F(); const s = S();
    if (k === 'mname') { const m = mById(el.dataset.id); m.name = el.value.slice(0, 16); const a = el.parentElement.querySelector('.avatar'); if (a) a.textContent = m.name.charAt(0); }
    if (k === 'fname') f.name = el.value.trim() || 'Our family';
    if (k === 'sname') s.name = el.value;
    if (k === 'income') s.income = Math.max(0, Number(el.value) || 0);
    if (k === 'movedate') { f.moveDate = el.value; gSave(); rerender(); return; }
    if (k === 'f-range') { // live labels while dragging; the list re-renders on 'change'
      const fl = MF(); const { lo, hi } = priceBounds(); const v = Number(el.value);
      if (el.dataset.key === 'minPrice') fl.minPrice = v <= lo ? 0 : Math.min(v, fl.maxPrice || hi);
      else fl.maxPrice = v >= hi ? 0 : Math.max(v, fl.minPrice || lo);
      const mn = document.getElementById('g-minLbl'); const mx = document.getElementById('g-maxLbl'); const pc = document.getElementById('g-poolCount');
      if (mn) mn.textContent = shortMoney(fl.minPrice || lo);
      if (mx) mx.textContent = shortMoney(fl.maxPrice || hi) + (fl.maxPrice ? '' : '+');
      if (pc) { pc.innerHTML = poolText(); pc.classList.toggle('zero', !gPool().length); }
    }
    if (k === 'draft-q') pollDraft.q = el.value;
    if (k === 'draft-opt') pollDraft.options[Number(el.dataset.val)] = el.value;
    if (k === 'adv-note') { const a = s.advisors.find((x) => x.id === s.advisorOn); a.votes[el.dataset.id] = { ...(a.votes[el.dataset.id] || {}), note: el.value }; }
    gSave();
  }
  function onKey(e) {
    if (!takeover()) return;
    if (e.key === 'Escape' && gSheet) { if (gSheet.name !== 'pass') closeSheet(); return; }
    if (gSheet || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const o = G.mode === 'family' ? F() : G.mode === 'solo' ? S() : null;
    if (!o || !o.done || o.view !== 'discover' || !topCard()) return;
    const recheck = topCard().classList.contains('g-recheck');
    if (e.key === 'ArrowRight') gSwipe('like');
    if (e.key === 'ArrowLeft') gSwipe('pass');
    if (e.key === 'ArrowUp' && !recheck) { e.preventDefault(); gSwipe('love'); }
  }
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', (e) => {
    if (e.target.dataset.gIn === 'movedate') onInput(e);
    if (e.target.dataset.gIn === 'f-range') { gSave(); if (gSheet) drawSheet(true); rerender(); }
  });
  document.addEventListener('keydown', onKey);

  // couple mode: add a "Change group" entry point to app.js's screens
  function afterRender(app) {
    if (takeover()) return;
    const foot = app.querySelector('.side-foot');
    if (foot && !foot.querySelector('[data-g="change-mode"]')) {
      const b = document.createElement('button');
      b.className = 'side-link'; b.dataset.g = 'change-mode'; b.innerHTML = `${icon('swap')}Change group`;
      foot.insertBefore(b, foot.querySelector('.side-src'));
    }
    const bar = app.querySelector('.topbar');
    if (bar && !bar.querySelector('[data-g="change-mode"]')) {
      const b = document.createElement('button');
      b.className = 'icon-btn g-couple-switch'; b.dataset.g = 'change-mode'; b.setAttribute('aria-label', 'Change group'); b.title = 'Change group (couple, family, solo)';
      b.innerHTML = icon('swap');
      bar.appendChild(b);
    }
    const setup = app.querySelector('.onboard .setup');
    if (setup && state.setupStep === 0 && !setup.querySelector('[data-g="change-mode"]')) {
      const b = document.createElement('button');
      b.className = 'link g-back-modes'; b.dataset.g = 'change-mode'; b.innerHTML = `${icon('left')}Not a couple? Choose family or solo`;
      setup.insertBefore(b, setup.querySelector('.brand'));
    }
  }

  window.NMGroups = { takeover, render: gRender, afterRender, mode: effectiveMode };
}());
