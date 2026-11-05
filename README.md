# NestMatch (demo v2)

A Tinder-style house-hunting app for couples. Each partner swipes on their own. When both swipe right on a home, it becomes a match. Matches can be compared and analyzed, then go head to head in the Final Round until only one home is left.

Run it: `cd ~/house-swipe-demo && node server.js`, then open http://localhost:3008

## What's in it
- Onboarding: names, then each partner's work location, max commute, dealbreakers and nice-to-haves, then a shared budget.
- Discover: photo cards (tap the photo edges to see more photos), like, pass, or love (super-like), undo, "why not?" feedback that suggests filter changes, and a detail panel on desktop.
- Details: photo gallery, monthly cost breakdown (down payment and rate are adjustable), both partners' commutes, schools, flood risk, and a map.
- Matches: list sorted by fit, price, monthly cost or commute; a map view; side-by-side compare of up to 3 homes; and an "Almost" list with "ask them to rethink".
- Us: an in-sync score, where you agree, and where you differ.
- Final Round: hidden votes, head to head, ending with a "you found the one" screen and next steps (tour request with consent wording, pre-approval, share).

## Data
- Default: 48 sample Metro Detroit, Michigan homes (Royal Oak, Birmingham, Troy, Novi, Ann Arbor and more) in `data.js`. Prices and addresses are made up. Photos are SimplyRETS's public demo listing photos.
- Live (optional): put `RENTCAST_API_KEY=...` in `.env` and restart the server. Then go to Preferences & data, enter a city and state, and load. Real active listings come in with no photos, so a placeholder is shown. Results are cached in `.cache/` for 24 hours (the free plan allows 50 requests a month).
- Realtor.com, Zillow and Redfin don't allow scraping or redistributing their listings. Real launch data means an MLS IDX feed through a licensed broker (see ~/house-swipe-research/FINDINGS.md).

v1 (the cartoon prototype) is kept in `v1/`.
