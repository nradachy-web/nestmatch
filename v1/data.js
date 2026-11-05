// Sample listings for the demo. All homes, addresses and neighborhoods are made up.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['Single-family', 'Ranch', 'Townhouse', 'Condo'];
const FEATURES = [
  'Big yard', 'Garage', 'Pool', 'Home office', 'Updated kitchen',
  'Basement', 'Fireplace', 'Open floor plan', 'Patio / deck', 'Walk-in closet',
];
// pricePerSqft gives each neighborhood its own price level
const HOODS = [
  { name: 'Maple Hollow', ppsf: 165 },
  { name: 'Riverbend', ppsf: 210 },
  { name: 'Old Town', ppsf: 265 },
  { name: 'Lakeview', ppsf: 310 },
  { name: 'Brookstone', ppsf: 190 },
  { name: 'Willow Creek', ppsf: 235 },
];
const STREETS = ['Oak', 'Birch', 'Juniper', 'Sycamore', 'Hawthorne', 'Linden', 'Aspen',
  'Magnolia', 'Chestnut', 'Elm', 'Poplar', 'Laurel', 'Cypress', 'Alder', 'Hazel', 'Spruce'];
const SUFFIXES = ['St', 'Ave', 'Ln', 'Dr', 'Ct', 'Way', 'Pl', 'Rd'];

const OPENERS = ['Move-in ready', 'Sun-filled', 'Freshly painted', 'Well-kept', 'Charming', 'Quiet', 'Bright and airy', 'Classic'];
const CLOSERS = [
  'Walkable to coffee shops and a park.',
  'Short drive to schools and groceries.',
  'Tree-lined street with friendly neighbors.',
  'New roof and HVAC within the last five years.',
  'Plenty of storage throughout.',
  'Great natural light in the main living area.',
];

const LISTINGS = (() => {
  const rand = mulberry32(20261103);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const out = [];

  for (let i = 0; i < 120; i++) {
    const type = pick(['Single-family', 'Single-family', 'Ranch', 'Townhouse', 'Condo']);
    const hood = pick(HOODS);
    const beds = {
      'Single-family': int(3, 5), Ranch: int(2, 4), Townhouse: int(2, 4), Condo: int(1, 3),
    }[type];
    const baths = Math.min(beds + 0.5, Math.max(1, beds - 1 + (rand() < 0.5 ? 0.5 : 0) + (rand() < 0.4 ? 1 : 0)));
    const sqft = Math.round((450 + beds * 430 + int(-150, 350)) / 10) * 10;
    const price = Math.round((sqft * hood.ppsf * (0.85 + rand() * 0.3)) / 5000) * 5000;

    // condos/townhomes don't get yards or pools
    const pool = FEATURES.filter((f) =>
      !(['Condo', 'Townhouse'].includes(type) && ['Big yard', 'Pool', 'Basement'].includes(f)));
    const features = [];
    const nFeat = int(2, 5);
    while (features.length < nFeat) {
      const f = pick(pool);
      if (!features.includes(f)) features.push(f);
    }

    const f1 = features[0].toLowerCase();
    const f2 = features[1].toLowerCase();
    out.push({
      id: `h${i + 1}`,
      seed: i * 7919 + 13,
      type,
      price,
      beds,
      baths,
      sqft,
      year: int(1955, 2024),
      lot: ['Condo', 'Townhouse'].includes(type) ? null : (rand() * 0.6 + 0.12).toFixed(2),
      hood: hood.name,
      address: `${int(100, 9899)} ${pick(STREETS)} ${pick(SUFFIXES)}`,
      features,
      commute: int(8, 45),
      description: `${pick(OPENERS)} ${type.toLowerCase()} home in ${hood.name} with ${f1} and ${f2}. ${pick(CLOSERS)}`,
    });
  }
  return out;
})();

// Draws a simple flat illustration of the house so the demo works offline.
function houseSVG(h) {
  const r = mulberry32(h.seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const sky = pick(['#DCEAF2', '#F3E6D8', '#E2EEE6', '#E8E4F0']);
  const grass = pick(['#B9CDA5', '#A9C29A', '#C3D3AE']);
  const body = pick(['#F1E7D3', '#CFDCE3', '#DCE5DA', '#E9D7C4', '#D7D2C8', '#F4EEE6']);
  const roof = pick(['#3F4A5A', '#6B4F3F', '#36566A', '#7A4B45', '#4B5543']);
  const door = pick(['#D0633F', '#2F6690', '#3A7D5B', '#E1A43B', '#3F4A5A']);
  const win = '#FFFFFF';
  const glass = '#9DC3D8';
  const has = (f) => h.features.includes(f);

  const window_ = (x, y, w = 26, ht = 24) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${ht}" rx="2" fill="${glass}" stroke="${win}" stroke-width="3"/>`;
  const tree = (x) =>
    `<rect x="${x - 4}" y="178" width="8" height="30" fill="#6B4F3F"/><circle cx="${x}" cy="168" r="24" fill="#5E8C5A"/><circle cx="${x + 14}" cy="180" r="16" fill="#6E9C66"/>`;

  let s = `<svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`;
  s += `<rect width="400" height="260" fill="${sky}"/><circle cx="335" cy="52" r="20" fill="#fff" opacity=".75"/>`;
  s += `<rect y="205" width="400" height="55" fill="${grass}"/>`;
  s += `<rect x="150" y="205" width="100" height="55" fill="#E6DFD2" opacity=".7"/>`;

  if (has('Big yard')) s += tree(52);

  if (h.type === 'Single-family') {
    if (has('Fireplace')) s += `<rect x="240" y="52" width="16" height="36" fill="${roof}"/>`;
    s += `<rect x="130" y="95" width="140" height="110" fill="${body}"/>`;
    s += `<polygon points="118,100 200,45 282,100" fill="${roof}"/>`;
    s += window_(148, 112) + window_(226, 112) + window_(148, 160) + window_(226, 160);
    s += `<rect x="187" y="158" width="26" height="47" rx="2" fill="${door}"/>`;
    if (has('Garage')) {
      s += `<rect x="270" y="140" width="72" height="65" fill="${body}"/><polygon points="264,144 306,118 348,144" fill="${roof}"/>`;
      s += `<rect x="282" y="158" width="48" height="47" fill="#fff" opacity=".85"/><path d="M282 170h48M282 182h48M282 194h48" stroke="#C9C3B8" stroke-width="2"/>`;
    } else if (has('Big yard')) s += tree(352);
  } else if (h.type === 'Ranch') {
    if (has('Fireplace')) s += `<rect x="130" y="98" width="15" height="30" fill="${roof}"/>`;
    s += `<rect x="85" y="140" width="${has('Garage') ? 210 : 230}" height="65" fill="${body}"/>`;
    s += `<polygon points="72,145 ${has('Garage') ? 190 : 200},100 ${has('Garage') ? 308 : 328},145" fill="${roof}"/>`;
    s += window_(102, 158, 30, 22) + window_(142, 158, 30, 22) + window_(232, 158, 30, 22);
    s += `<rect x="190" y="158" width="24" height="47" rx="2" fill="${door}"/>`;
    if (has('Garage')) {
      s += `<rect x="295" y="150" width="70" height="55" fill="${body}"/><polygon points="290,154 330,132 370,154" fill="${roof}"/>`;
      s += `<rect x="305" y="165" width="50" height="40" fill="#fff" opacity=".85"/><path d="M305 177h50M305 189h50" stroke="#C9C3B8" stroke-width="2"/>`;
    } else if (has('Big yard')) s += tree(360);
  } else if (h.type === 'Townhouse') {
    const tones = [body, pick(['#CFDCE3', '#E9D7C4', '#DCE5DA']), body];
    [92, 164, 236].forEach((x, k) => {
      s += `<rect x="${x}" y="80" width="72" height="125" fill="${tones[k]}" stroke="#fff" stroke-width="2"/>`;
      s += `<polygon points="${x - 4},84 ${x + 36},58 ${x + 76},84" fill="${roof}"/>`;
      s += window_(x + 10, 96, 22, 22) + window_(x + 40, 96, 22, 22) + window_(x + 10, 140, 22, 22);
      s += `<rect x="${x + 42}" y="160" width="20" height="45" rx="2" fill="${k === 1 ? door : roof}"/>`;
    });
  } else {
    s += `<rect x="118" y="34" width="164" height="171" fill="${body}"/><rect x="112" y="28" width="176" height="10" fill="${roof}"/>`;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 4; col++)
        if (!(row === 4 && (col === 1 || col === 2))) s += window_(132 + col * 36, 48 + row * 30, 22, 18);
    s += `<rect x="180" y="168" width="40" height="37" rx="2" fill="${door}"/>`;
  }

  if (has('Pool')) s += `<rect x="20" y="222" width="100" height="24" rx="10" fill="#7FC4DD" stroke="#fff" stroke-width="3"/>`;
  if (has('Patio / deck') && h.type !== 'Condo') s += `<rect x="262" y="226" width="96" height="14" rx="2" fill="#B08968"/>`;
  return s + '</svg>';
}
