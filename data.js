// Sample market for the demo: Metro Detroit, Michigan homes. Prices, addresses and details are made up.
// Photos are SimplyRETS's public demo listing photos. Once a real MLS/IDX feed is connected,
// each listing brings its own photos.

const PHOTO_BASE = 'https://d2bd5h5te3s67r.cloudfront.net/trial/';
// exterior photo number -> architectural style
const EXTERIORS = {
  1: 'Ranch', 2: 'Traditional', 3: 'Traditional', 4: 'Traditional', 5: 'Modern', 6: 'Traditional',
  7: 'Traditional', 8: 'Ranch', 9: 'Mediterranean', 10: 'Tudor', 11: 'Craftsman', 12: 'Craftsman',
  13: 'Tudor', 14: 'Ranch', 15: 'Ranch', 16: 'Mediterranean',
};
const ROOMS = {
  living: [1, 2, 3, 5, 7, 8, 9, 10, 16],
  bedroom: [4, 13, 14, 15],
  other: [6, 11, 12],
};

const STYLES = ['Traditional', 'Ranch', 'Craftsman', 'Modern', 'Mediterranean', 'Tudor'];
const FEATURES = [
  'Big yard', 'Pool', 'Home office', 'Updated kitchen', 'Primary on main', 'Fireplace',
  'Open floor plan', 'Covered patio', 'Walk-in closets', 'New roof', 'Smart home', 'EV charger',
];
// Hard requirements a partner can set. Each one is a test on a listing.
const DEALBREAKERS = {
  'Garage (2+ cars)': (l) => l.garage >= 2,
  'Big yard': (l) => l.features.includes('Big yard'),
  Pool: (l) => l.features.includes('Pool'),
  'Home office': (l) => l.features.includes('Home office'),
  'Primary on main': (l) => l.features.includes('Primary on main'),
  'Single story': (l) => l.stories === 1,
  'Low flood risk': (l) => l.flood === 'Minimal',
  'No HOA': (l) => !l.hoa,
  'Schools 8+': (l) => l.school >= 8,
  'Built 2000+': (l) => l.year >= 2000,
};

const SAMPLE_MARKET = 'Metro Detroit, MI';
const HOODS = [
  { name: 'Royal Oak', zip: '48067', lat: 42.4895, lng: -83.1446, ppsf: 210, school: 8, flood: 0.12 },
  { name: 'Ferndale', zip: '48220', lat: 42.4606, lng: -83.1346, ppsf: 190, school: 6, flood: 0.15 },
  { name: 'Birmingham', zip: '48009', lat: 42.5467, lng: -83.2113, ppsf: 300, school: 9, flood: 0.08 },
  { name: 'Troy', zip: '48098', lat: 42.6064, lng: -83.1498, ppsf: 175, school: 9, flood: 0.06 },
  { name: 'Novi', zip: '48375', lat: 42.4806, lng: -83.4755, ppsf: 180, school: 9, flood: 0.05 },
  { name: 'Northville', zip: '48167', lat: 42.4311, lng: -83.4833, ppsf: 215, school: 9, flood: 0.06 },
  { name: 'Plymouth', zip: '48170', lat: 42.3714, lng: -83.4702, ppsf: 205, school: 8, flood: 0.08 },
  { name: 'Canton', zip: '48187', lat: 42.3087, lng: -83.4821, ppsf: 160, school: 8, flood: 0.1 },
  { name: 'Grosse Pointe', zip: '48230', lat: 42.3862, lng: -82.9119, ppsf: 185, school: 8, flood: 0.2 },
  { name: 'Ann Arbor', zip: '48104', lat: 42.2808, lng: -83.7430, ppsf: 265, school: 9, flood: 0.1 },
];

// Where each partner works, for commute estimates.
const WORK_HUBS = {
  remote: { name: 'Work from home' },
  downtown: { name: 'Downtown Detroit', lat: 42.3314, lng: -83.0458 },
  troy: { name: 'Troy', lat: 42.5617, lng: -83.166 },
  southfield: { name: 'Southfield', lat: 42.4734, lng: -83.2219 },
  dearborn: { name: 'Dearborn', lat: 42.315, lng: -83.211 },
  annarbor: { name: 'Ann Arbor', lat: 42.278, lng: -83.7382 },
  auburnhills: { name: 'Auburn Hills', lat: 42.6875, lng: -83.2341 },
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_LISTINGS = (() => {
  const rand = mulberry32(77008);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const STREETS = ['Maple Rd', 'Lakeview Dr', 'Cranbrook Ct', 'Huron St', 'Superior Ave', 'Elm Grove Ln',
    'Larchmont Rd', 'Pinewood Trl', 'Cedar Glen Dr', 'Shady Oak Ln', 'Birchwood Way', 'Hickory Ct', 'Sugar Maple Dr',
    'Willow Bend Ln', 'Stonebridge Dr', 'Orchard Lake Rd', 'Cherry Hill Ln', 'Lantern Point Dr', 'Hollow Creek Rd', 'Red Oak Ridge'];
  const INTROS = {
    Traditional: 'Classic two-story with a welcoming entry and a formal dining room',
    Ranch: 'Single-level living with an easy, open layout and wide hallways',
    Craftsman: 'Character-filled craftsman with a deep front porch and original built-ins',
    Modern: 'Clean-lined modern build with oversized windows and high ceilings',
    Mediterranean: 'Mediterranean-style home with arched doorways and a tile roof',
    Tudor: 'Storybook Tudor with steep gables, brick details and a cozy feel',
  };
  const DETAILS = {
    'Big yard': 'a large fenced backyard with room for a garden or play set',
    Pool: 'a sparkling backyard pool',
    'Home office': 'a quiet home office with French doors',
    'Updated kitchen': 'a renovated kitchen with quartz counters and stainless appliances',
    'Primary on main': 'the primary suite on the main floor',
    Fireplace: 'a gas fireplace for Michigan winters',
    'Open floor plan': 'an open kitchen-to-living layout that is great for hosting',
    'Covered patio': 'a covered patio for summer grilling',
    'Walk-in closets': 'his-and-hers walk-in closets',
    'New roof': 'a roof replaced in 2023',
    'Smart home': 'a smart thermostat, doorbell and locks',
    'EV charger': 'a Level 2 EV charger in the garage',
  };
  const out = [];
  const extIds = Object.keys(EXTERIORS).map(Number);

  for (let i = 0; i < 48; i++) {
    const ext = extIds[i % extIds.length];
    const style = EXTERIORS[ext];
    const hood = HOODS[(i * 7 + int(0, 3)) % HOODS.length];
    const stories = style === 'Ranch' ? 1 : (rand() < 0.8 ? 2 : 1);
    const beds = style === 'Ranch' ? int(3, 4) : int(3, 5);
    const sqft = Math.round((900 + beds * 480 + int(-250, 600)) / 10) * 10;
    const baths = Math.min(beds + 0.5, Math.max(2, beds - 1 + (rand() < 0.5 ? 0.5 : 0)));
    const price = Math.round((sqft * hood.ppsf * (0.88 + rand() * 0.24)) / 5000) * 5000;

    const pool = FEATURES.filter((f) => !(stories > 1 && f === 'Primary on main' && rand() < 0.6));
    const features = [];
    const nFeat = int(3, 6);
    while (features.length < nFeat) {
      const f = pick(pool);
      if (!features.includes(f)) features.push(f);
    }
    if (stories === 1 && !features.includes('Primary on main')) features.push('Primary on main');

    const dom = int(1, 75);
    const living = ROOMS.living[(i * 3) % ROOMS.living.length];
    const bedroom = ROOMS.bedroom[i % ROOMS.bedroom.length];
    const other = ROOMS.other[i % ROOMS.other.length];
    const hoa = ['Novi', 'Northville', 'Canton', 'Troy'].includes(hood.name)
      ? int(4, 14) * 10 : (rand() < 0.2 ? int(2, 6) * 10 : 0);
    const floodRoll = rand();
    const extra = features.slice(0, 2).map((f) => DETAILS[f]);

    out.push({
      id: `s${i + 1}`,
      source: 'sample',
      // mirror every other repeat of an exterior so repeated photos look less alike
      flip: Math.floor(i / extIds.length) % 2 === 1,
      photos: [`home${ext}.jpg`, `home-inside-${living}.jpg`, `home-inside-${bedroom}.jpg`, `home-inside-${other}.jpg`]
        .map((f) => PHOTO_BASE + f),
      style,
      stories,
      price,
      originalPrice: rand() < 0.2 ? price + int(1, 4) * 10000 : price,
      beds,
      baths,
      sqft,
      lotSqft: style === 'Modern' || ['Ferndale', 'Royal Oak', 'Birmingham'].includes(hood.name) ? int(40, 70) * 100 : int(70, 140) * 100,
      year: style === 'Modern' ? int(2015, 2024) : style === 'Craftsman' || style === 'Tudor' ? int(1925, 1965) : int(1975, 2022),
      garage: rand() < 0.15 ? 1 : int(2, 3),
      hood: hood.name,
      city: hood.name,
      state: 'MI',
      zip: hood.zip,
      address: `${int(1, 9) * 1000 + int(10, 990)} ${pick(STREETS)}`,
      lat: hood.lat + (rand() - 0.5) * 0.03,
      lng: hood.lng + (rand() - 0.5) * 0.035,
      features,
      hoa,
      taxRate: 0.013 + rand() * 0.006,
      dom,
      school: Math.max(4, Math.min(10, hood.school + int(-1, 1))),
      flood: floodRoll < hood.flood * 0.4 ? 'High' : floodRoll < hood.flood ? 'Moderate' : 'Minimal',
      description: `${INTROS[style]}. Highlights include ${extra[0]} and ${extra[1]}. Located in ${hood.name}, close to shopping, parks and the freeway.`,
      office: 'NestMatch Demo Realty',
    });
  }
  return out;
})();

// Exterior photos used as placeholders for live listings that come without photos.
const PLACEHOLDER_PHOTOS = Object.keys(EXTERIORS).map((n) => `${PHOTO_BASE}home${n}.jpg`);
