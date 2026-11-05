# NestMatch collaboration

Several Claude sessions work in this folder. Only edit files you own. To change someone else's file, message its owner.

| File | Owner | Notes |
|---|---|---|
| app.js, data.js, server.js, styles.css, index.html, README.md | tot-47 (builder) | Couple mode and all core UI |
| theme.css | tot-36 (theme + QA) | Colors, fonts, corners, shadows. Loads after styles.css |
| groups.js, groups.css | tot-41 (group modes) | Picker, Family mode, Solo mode |

## Group modes contract
- `groups.js` stores its data in localStorage `nestmatch-groups-v1`: `{ mode: 'couple'|'family'|'solo'|null, family, solo }`. Couple data stays in `nestmatch-v2` and keeps its a/b shape.
- Existing couple saves (`setupStep > 0`) with no groups key count as couple mode. New users see "Who's house hunting?" first.
- app.js hooks (added by tot-47): `NMGroups.takeover()` / `NMGroups.render(app)` at the top of renderUnsafe, `NMGroups.afterRender(app)` at the end of it, and a takeover check in keydown.
- Family and solo keep their own filters and loan settings (`family.filters/finance`, `solo.filters/finance`) and never write `state.filters` or `state.finance`.
- groups.js only reads these app.js globals: listings, byId, money, shortMoney, num, esc, icon, photoTag, VIBES, confetti, toast, brandMark, sourceLabel, priceBounds, styleOptions, hoodOptions, bucket, hoaKey, MONTHLY_BUCKETS, BED_OPTS, BATH_OPTS, SIZE_BUCKETS, HOA_OPTS, state.setupStep, plus WORK_HUBS, DEALBREAKERS, FEATURES, HOODS and PHOTO_BASE from data.js. Tell tot-41 before renaming any of them.
- groups.js uses `data-g` attributes (never `data-act`) and its own `#g-overlay`, including its own Filters sheet.
- Both app.js resets clear `nestmatch-v2` and `nestmatch-groups-v1`. groups.js also has its own per-mode repair screen.
- groups.css reuses theme variables. The only new colors are member avatars `--g-m2..7`.
