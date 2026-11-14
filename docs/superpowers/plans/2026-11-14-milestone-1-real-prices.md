# Milestone 1: Real Prices on the Blend Screen. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Cosmin's Mac, one command collects Storia sale listings for Bucharest and another opens the Blend screen showing real price cells, real apartments and working filters.

**Architecture:** A Node collector sweeps Storia's public search pages, then fetches listing pages for exact positions, and keeps everything in one SQLite file. An export step writes static JSON files. A static React + MapLibre website reads those files and does all filtering and cell colouring in the browser.

**Tech Stack:** TypeScript, Node 22 (`node:sqlite`, built-in `fetch`), tsx, Vitest, Vite, React, MapLibre GL, h3-js, OpenFreeMap tiles, OpenStreetMap data via Overpass.

**Spec:** `docs/superpowers/specs/2026-11-14-bucharest-price-map-design.md`. Screen reference: `prototypes/map-versions.html`, fourth version (`blend`). Copy its layout and behaviour, not its code.

## Global Constraints

- New dependencies allowed without asking: `typescript`, `tsx`, `vitest`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `maplibre-gl`, `h3-js`, and their type packages. Anything else: ask Cosmin first.
- No paid services, no API keys. Nothing in this milestone needs a secret.
- Collection is polite: one request at a time, at least 1.2 s between requests (Cosmin chose this faster pace on 2026-11-14, accepting a somewhat higher block risk; it was 2.5 s), a browser-like User-Agent with no personal details, stop the run on HTTP 403 or 429.
- Area: Bucharest only (six sectors). Apartments for sale only.
- All interface copy is Romanian. Numbers use a thin space for thousands and `€` after the number (`2 600 €/m²`, `185 000 €`).
- Desktop first; at widths under 860 px a list / map switch replaces the two panes, and every hover has a tap equivalent.
- The legend says "Preț cerut pe m²" (asking price), never "price".
- Collected data (`data/`, `web/public/data/listings.json`, `web/public/data/meta.json`) stays out of git.
- Cosmin cannot read code. Each task ends with the stated run command passing; Tasks 9 to 11 end with a screenshot shown to him.

## What is already known about Storia (checked 2026-11-14)

- Search: `https://www.storia.ro/ro/rezultate/vanzare/apartament/bucuresti?page=N`. The page embeds JSON in `<script id="__NEXT_DATA__">`. Listings are at `props.pageProps.data.searchAds.items` (36 per page); `props.pageProps.data.searchAds.pagination` has `totalPages` (681) and `totalItems` (24,481).
- A search item has: `id`, `slug`, `title`, `totalPrice {value, currency}`, `pricePerSquareMeter {value, currency}`, `areaInSquareMeters`, `roomsNumber` (`"ONE"`…`"TEN"`), `floorNumber` (`"GROUND"`, `"FIRST"`, `"FOURTH"`, …), `isPrivateOwner`, `dateCreated`, `hidePrice`, `developmentId` (0 when none), `priceFromPerSquareMeter`, `investmentUnitsNumber`, `location.address.street.name`, and `location.reverseGeocoding.locations[]` with `locationLevel` of `county`, `sector`, `district` and a `name`.
- Listing page: `https://www.storia.ro/ro/oferta/<slug>`. Its `__NEXT_DATA__` has `props.pageProps.ad` with `location.coordinates {latitude, longitude}`, `location.mapDetails.radius` (0 means exact), and `characteristics[]` of `{key, value}` including `build_year` and `market` (`primary` / `secondary`).

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, README.md
shared/types.ts            Listing and export types used by both sides
collector/
  storia/parseSearch.ts    search page HTML -> listings + page count
  storia/parseDetail.ts    listing page HTML -> position, year, market
  fetcher.ts               paced, retrying, block-aware page fetcher
  store.ts                 SQLite schema and queries
  geo.ts                   distances, walking minutes, nearest feature
  osm.ts                   one-off download of metro stations and parks
  dedupe.ts                merge reposts of the same apartment
  export.ts                SQLite -> web/public/data/*.json
  cli.ts                   `sweep`, `details`, `export`, `osm` commands
  fixtures/                saved search.html and detail.html
web/
  index.html, vite.config.ts
  public/data/             metro.geojson, parks.geojson (committed); listings.json, meta.json (ignored)
  src/main.tsx, App.tsx, styles.css
  src/copy.ts              every Romanian string
  src/format.ts            number, price, date formatting
  src/logic.ts             filtering, cell stats, list ordering (pure)
  src/useData.ts           loads the data files, exposes loading / error
  src/Map.tsx              MapLibre map and all layers
  src/Panel.tsx            filters and the apartment list
  src/Card.tsx             one apartment card
```

## Review Focus

Inputs the design implies that would otherwise slip through. Each is pinned by a test in the task named.

1. A listing with a hidden price, a zero area, or a price not in EUR must be skipped and counted, not crash the sweep or show as `NaN` (Task 1).
2. A listing whose position is missing or approximate (`radius > 0`) must stay out of the price cells but remain in neighbourhood medians (Tasks 2, 6, 8).
3. A sweep that is blocked halfway (403/429) must leave the previous export untouched and report failure (Tasks 4, 6).
4. Typo prices (`pricePerSquareMeter` under 400 or over 15 000 €) must not colour a cell or win "best value" (Task 6).
5. Listings that vanished from the site must drop out after the next complete sweep, and a partly finished first collection must show how much is covered instead of an empty-looking map (Tasks 6, 9).

---

### Task 1: Project setup and the search-page parser

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `shared/types.ts`, `collector/storia/parseSearch.ts`, `collector/fixtures/search.html`
- Test: `collector/storia/parseSearch.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:

```ts
export type SearchListing = {
  id: string;            // "storia:10733327"
  url: string;           // https://www.storia.ro/ro/oferta/<slug>
  title: string;
  total: number;         // EUR
  ppm: number;           // EUR per m², rounded
  m2: number;
  rooms: number;         // 1..10
  floor: number | null;  // 0 = ground; null when unknown
  street: string | null;
  district: string | null;   // locationLevel "district"
  sector: string | null;     // locationLevel "sector"
  privateOwner: boolean;
  isNewDev: boolean;     // developmentId > 0
  fromPrice: boolean;    // priceFromPerSquareMeter or investmentUnitsNumber present
  postedAt: string;      // ISO date
};
export type SearchPage = { listings: SearchListing[]; skipped: number; totalPages: number };
```

- Produces: `parseSearchPage(html: string): SearchPage` in `collector/storia/parseSearch.ts`. Throws `Error("Storia search page has no listing data")` when the embedded JSON or the items array is missing.

- [ ] **Step 1: Set up the project.** `git init`. `package.json` with `"type": "module"` and scripts `test` (`vitest run`), `collect` (`tsx collector/cli.ts sweep && tsx collector/cli.ts details && tsx collector/cli.ts export`), `dev` (`vite web`), `build` (`vite build web`). Install the allowed dependencies. `.gitignore`: `node_modules`, `.env*`, `data/`, `web/public/data/listings.json`, `web/public/data/meta.json`, `web/dist`, `.superpowers/`.
- [ ] **Step 2: Save the fixture.** Fetch page 1 of the search URL once with the Global Constraints User-Agent into `collector/fixtures/search.html`.
- [ ] **Step 3: Write the failing tests.**

```ts
const page = parseSearchPage(readFileSync('collector/fixtures/search.html', 'utf8'));
test('reads a full page', () => {
  expect(page.listings.length + page.skipped).toBe(36);
  expect(page.totalPages).toBeGreaterThan(100);
});
test('every listing is usable', () => {
  for (const l of page.listings) {
    expect(l.id).toMatch(/^storia:\d+$/);
    expect(l.url).toMatch(/^https:\/\/www\.storia\.ro\/ro\/oferta\//);
    expect(l.total).toBeGreaterThan(0);
    expect(l.m2).toBeGreaterThan(0);
    expect(l.ppm).toBe(Math.round(l.total / l.m2));
    expect(l.rooms).toBeGreaterThanOrEqual(1);
    expect(l.sector).toMatch(/^Sectorul [1-6]$/);
  }
});
test('skips listings it cannot price', () => {
  const html = withItems([{ ...validItem, hidePrice: true }, { ...validItem, totalPrice: { value: 900000, currency: 'RON' } }, { ...validItem, areaInSquareMeters: 0 }, validItem]);
  expect(parseSearchPage(html)).toMatchObject({ skipped: 3, listings: [{ id: 'storia:1' }] });
});
test('maps room and floor words', () => {
  const [l] = parseSearchPage(withItems([{ ...validItem, roomsNumber: 'THREE', floorNumber: 'GROUND' }])).listings;
  expect([l.rooms, l.floor]).toEqual([3, 0]);
});
test('fails loudly on a page without data', () => {
  expect(() => parseSearchPage('<html></html>')).toThrow('Storia search page has no listing data');
});
```

`withItems(items)` and `validItem` (id 1) are test helpers that wrap items in the minimal `__NEXT_DATA__` shape.

- [ ] **Step 4:** Run `npm test`. Expected: fails, `parseSearchPage` not defined.
- [ ] **Step 5: Implement `parseSearchPage`.** `ppm` is computed as `Math.round(total / m2)`, not read from the site. Unknown floor words give `null`.
- [ ] **Step 6:** Run `npm test`. Expected: 5 passed.
- [ ] **Step 7:** Commit: `feat: parse Storia search pages`.

### Task 2: The listing-page parser

**Files:**
- Create: `collector/storia/parseDetail.ts`, `collector/fixtures/detail.html`
- Test: `collector/storia/parseDetail.test.ts`

**Interfaces:**
- Produces: `parseDetailPage(html: string): Detail | null`, with `type Detail = { lat: number | null; lng: number | null; precise: boolean; year: number | null; market: 'primary' | 'secondary' | null }` added to `shared/types.ts`. Returns `null` when the page has no `ad` (expired listing).

- [ ] **Step 1:** Fetch one listing page from the search fixture into `collector/fixtures/detail.html`.
- [ ] **Step 2: Write the failing tests.**

```ts
test('reads position and year from a real page', () => {
  const d = parseDetailPage(fixture)!;
  expect(d.lat).toBeGreaterThan(44.33); expect(d.lat).toBeLessThan(44.55);
  expect(d.lng).toBeGreaterThan(25.95); expect(d.lng).toBeLessThan(26.25);
});
test('an exact pin is precise, a radius is not', () => {
  expect(parseDetailPage(withAd({ radius: 0 }))!.precise).toBe(true);
  expect(parseDetailPage(withAd({ radius: 300 }))!.precise).toBe(false);
});
test('a position outside Bucharest is dropped', () => {
  expect(parseDetailPage(withAd({ latitude: 45.75, longitude: 21.22 }))).toMatchObject({ lat: null, lng: null, precise: false });
});
test('implausible build years become null', () => {
  expect(parseDetailPage(withAd({ build_year: '19' }))!.year).toBeNull();
  expect(parseDetailPage(withAd({ build_year: '1984' }))!.year).toBe(1984);
});
test('an expired listing gives null', () => { expect(parseDetailPage(withoutAd())).toBeNull(); });
```

- [ ] **Step 3:** Run `npm test`. Expected: fails, not defined.
- [ ] **Step 4: Implement.** Bucharest bounding box: lat 44.33 to 44.55, lng 25.95 to 26.25. Valid years: 1850 to current year + 5.
- [ ] **Step 5:** Run `npm test`. Expected: all passed.
- [ ] **Step 6:** Commit: `feat: parse Storia listing pages`.

### Task 3: The store

**Files:**
- Create: `collector/store.ts`
- Test: `collector/store.test.ts`

**Interfaces:**
- Produces:

```ts
export function openStore(path: string): Store;   // ':memory:' in tests, 'data/prices.sqlite' for real
export type Store = {
  startSweep(): number;                                    // returns sweep id
  saveSearchListings(sweepId: number, ls: SearchListing[]): void;   // upsert; sets last_sweep, keeps first_seen
  finishSweep(sweepId: number, ok: boolean): void;
  lastCompleteSweep(): { id: number; finishedAt: string } | null;
  needingDetail(limit: number): { id: string; url: string }[];      // no detail yet, seen in last complete sweep, newest posted first
  saveDetail(id: string, d: Detail | null): void;                   // null marks it checked-and-gone
  current(): StoredListing[];                                        // seen in the last complete sweep
  close(): void;
};
export type StoredListing = SearchListing & Partial<Detail> & { firstSeen: string; hasDetail: boolean };
```

- [ ] **Step 1: Write the failing tests:** saving the same listing in two sweeps keeps one row and the original `firstSeen`; a price change updates `total` and `ppm`; `current()` excludes a listing missing from the last complete sweep; `current()` still returns the previous sweep's listings while a newer sweep is unfinished or finished with `ok: false`; `needingDetail` skips listings that already have a detail or were marked gone.
- [ ] **Step 2:** Run `npm test`. Expected: fails.
- [ ] **Step 3: Implement** with `node:sqlite` (`DatabaseSync`). Tables `sweeps` and `listings`.
- [ ] **Step 4:** Run `npm test`. Expected: passed.
- [ ] **Step 5:** Commit: `feat: listing store`.

### Task 4: The collector commands

**Files:**
- Create: `collector/fetcher.ts`, `collector/cli.ts`
- Test: `collector/fetcher.test.ts`, `collector/cli.test.ts`

**Interfaces:**
- Produces: `createFetcher(opts: { delayMs: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): (url: string) => Promise<string>`. Waits `delayMs` between calls, retries twice on network errors and 5xx with 10 s then 30 s waits, throws `BlockedError` on 403 or 429 with no retry.
- Produces: `runSweep(store, get, log)` and `runDetails(store, get, log, cap = 4000)` exported from `cli.ts`; `cli.ts` dispatches `sweep | details | export | osm` from `process.argv[2]`.
- Consumes: `parseSearchPage`, `parseDetailPage`, `Store`.

- [ ] **Step 1: Write the failing tests** using a fake `fetchImpl` and a no-wait `sleep`:
  - fetcher: two calls wait `delayMs` once; a 500 then a 200 returns the body; a 403 throws `BlockedError` after exactly one request.
  - `runSweep` reads page 1, then pages 2..`totalPages`, and calls `finishSweep(id, true)`.
  - `runSweep` blocked on page 3: calls `finishSweep(id, false)`, rejects with `BlockedError`, and `store.current()` still returns the earlier sweep's listings.
  - `runDetails` stops at `cap`, saves `null` for an expired page, and on `BlockedError` keeps the details saved so far.
- [ ] **Step 2:** Run `npm test`. Expected: fails.
- [ ] **Step 3: Implement.** Real runs use `delayMs: 2500`. Each command logs one progress line per 25 pages or 100 listings and ends with a plain-language summary line, for example `Gata: 24 481 anunțuri citite, 12 sărite.` or `Oprit: Storia a refuzat cererea (403). Datele de ieri rămân valabile.` Exit code 1 on failure.
- [ ] **Step 4:** Run `npm test`. Expected: passed.
- [ ] **Step 5: Try it for real, briefly.** Temporarily limit the sweep to 3 pages and details to 5; confirm rows land in `data/prices.sqlite`; remove the limit.
- [ ] **Step 6:** Commit: `feat: polite Storia collector`.

### Task 5: Metro and park reference data

**Files:**
- Create: `collector/geo.ts`, `collector/osm.ts`, `web/public/data/metro.geojson`, `web/public/data/parks.geojson`
- Test: `collector/geo.test.ts`

**Interfaces:**
- Produces in `geo.ts`: `metres(a: LngLat, b: LngLat): number` (haversine); `walkMinutes(m: number): number` = `Math.round(m * 1.3 / 80)`; `nearestPoint(p: LngLat, pts: Named[]): { name: string; minutes: number }`; `nearestPolygon(p: LngLat, polys: NamedPolygon[]): { name: string; minutes: number }` (0 minutes when inside; otherwise distance to the nearest edge vertex).
- Produces: `npm run collect`'s `osm` command, which queries Overpass once for Bucharest (`station=subway` nodes; `leisure=park` ways and relations of at least 1 hectare with a name) and writes the two GeoJSON files, plus metro lines (`route=subway` relations) as LineStrings in `metro.geojson` with a `colour` property.

- [ ] **Step 1: Write the failing tests:** Piața Unirii (26.1025, 44.4268) to Piața Victoriei (26.0864, 44.4527) is between 3 000 and 3 300 m; `walkMinutes(800)` is 13; `nearestPoint` picks the closer of two stations; a point inside a square polygon gives 0 minutes.
- [ ] **Step 2:** Run `npm test`. Expected: fails.
- [ ] **Step 3: Implement** `geo.ts`, then `osm.ts`; run `tsx collector/cli.ts osm`.
- [ ] **Step 4: Verify the data:** the metro file has between 55 and 75 stations and 5 or 6 lines; the parks file includes "Parcul Regele Mihai I" or "Parcul Herăstrău", "Parcul Tineretului" and "Parcul Alexandru Ioan Cuza".
- [ ] **Step 5:** Commit both GeoJSON files: `feat: metro and park reference data`.

### Task 6: Merge reposts and export the data files

**Files:**
- Create: `collector/dedupe.ts`, `collector/export.ts`
- Test: `collector/dedupe.test.ts`, `collector/export.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:

```ts
export type MapListing = {
  id: string; url: string; also: string[];      // other posts of the same apartment
  title: string; total: number; ppm: number; m2: number; rooms: number;
  floor: number | null; year: number | null;
  lat: number | null; lng: number | null; precise: boolean;
  cell: string | null;                          // H3 index, resolution 9, only when precise
  district: string | null; sector: string | null;
  metro: { name: string; minutes: number } | null;   // null when no position
  park: { name: string; minutes: number } | null;
  isNewDev: boolean; inStats: boolean;          // false when fromPrice
  delta: number | null;                         // % against the basis median, negative = cheaper
  deltaBasis: 'district' | 'sector' | null; basisName: string | null;
};
export type Meta = { updatedAt: string; total: number; placed: number; skippedOutliers: number; merged: number };
```

- Produces: `mergeReposts(ls: StoredListing[]): { kept: StoredListing[]; also: Map<string, string[]> }` and `buildExport(ls: StoredListing[], metro, parks, sweepFinishedAt: string): { listings: MapListing[]; meta: Meta }`; the `export` command writes `web/public/data/listings.json` and `meta.json`, writing to a temp file and renaming so a failure never leaves a half file.

Rules the tests pin:

- Repost: same `sector`, `rooms`, `floor`, `m2` within 1 m², `total` within 3 %, and either both precise and within 50 m, or both not precise with the same `street` and `district`. Keep the earliest `firstSeen`.
- Outlier: `ppm < 400` or `ppm > 15000` is dropped and counted in `skippedOutliers`.
- Median basis: the district median over listings with `inStats`, when that district has at least 15 of them; otherwise the sector median; otherwise `delta` is `null`.
- Agents often drop the pin on a neighbourhood centre or their usual spot instead of the building. After merging reposts, when 4 or more different listings share the same coordinates (rounded to 5 decimals), all of them are downgraded to `precise: false`. The street and district stay trusted.
- `cell` is set only when `precise`. `meta.placed` counts listings with a position.
- The export refuses to run (throws, files untouched) when there is no complete sweep.

- [ ] **Step 1: Write the failing tests:** two reposts merge and the survivor's `also` has the other URL; a 5 % price gap does not merge; a 100 €/m² listing is absent and `skippedOutliers` is 1; a district with 15 listings gives `deltaBasis: 'district'` and one with 14 gives `'sector'`; a listing 10 % under its basis median has `delta` −10; four different listings on identical coordinates all come out `precise: false` with `cell: null` while three stay precise; a non-precise listing has `cell: null` and still counts in its district median; a `fromPrice` listing has `inStats: false` and does not move the median; `buildExport` with no complete sweep throws.
- [ ] **Step 2:** Run `npm test`. Expected: fails.
- [ ] **Step 3: Implement.** `latLngToCell(lat, lng, 9)` from `h3-js`.
- [ ] **Step 4:** Run `npm test`. Expected: passed.
- [ ] **Step 5:** Commit: `feat: merge reposts and export map data`.

### Task 7: First real collection

No new code. This produces the data the web tasks are judged against.

- [ ] **Step 1:** Run `npm run collect`. The sweep is about 681 requests (roughly 30 minutes); details stop at 4 000 (roughly 3 hours). Run it in the background and continue with Task 8.
- [ ] **Step 2:** When done, check `meta.json`: `total` over 15 000, `placed` about 4 000, and report both numbers plus the count of merged reposts to Cosmin in one line.
- [ ] **Step 3:** If the run was blocked, stop and tell Cosmin what happened with the raw message; do not lower the delay or change the User-Agent to get around it without asking.

### Task 8: Filtering and cell logic

**Files:**
- Create: `web/src/logic.ts`, `web/src/format.ts`
- Test: `web/src/logic.test.ts`, `web/src/format.test.ts`

**Interfaces:**
- Produces:

```ts
export type Filters = {
  maxPpm: number | null; maxTotal: number | null; rooms: number[];   // empty = any; 4 means 4 or more
  minM2: number | null; minYear: number | null;
  maxMetroMin: number | null; parkWithin15: boolean; hideNewDev: boolean;
  district: string | null;       // set by clicking a cell
};
export const NO_FILTERS: Filters;
export function matches(l: MapListing, f: Filters): boolean;           // every filter
export function matchesKind(l: MapListing, f: Filters): boolean;       // rooms, minM2, minYear, hideNewDev only
export type CellStat = { cell: string; median: number | null; n: number; thin: boolean; faded: boolean; district: string | null };
export function cellStats(ls: MapListing[], f: Filters): CellStat[];
export function listFor(ls: MapListing[], f: Filters, bounds: [w: number, s: number, e: number, n: number]): MapListing[];
export const MIN_CELL_LISTINGS = 5;
```

- `format.ts`: `eur(n)` gives `185 000 €`; `eurM2(n)` gives `2 600 €/m²`; `thousands(n)` gives `185k`; `deltaText(l)` gives `12% sub mediana din Titan`, `8% peste mediana din Sectorul 3`, or `La mediana din Titan`.

Rules the tests pin:

- A listing with unknown `year` fails when `minYear` is set. A listing with no position fails when `maxMetroMin` or `parkWithin15` is set.
- `cellStats` colours from listings that are `precise`, `inStats` and pass `matchesKind`; `median` is their median `ppm`; `thin` when `n < 5` (then `median` is `null`).
- `faded` is true when no listing in the cell passes `matches` (ignoring `district`), or when `f.district` is set and the cell's `district` differs. A cell's `district` is the most common one among its listings.
- `listFor` returns listings passing `matches`, with a position inside `bounds`, sorted by `delta` ascending with `null` last.

- [ ] **Step 1: Write the failing tests,** one per rule above, plus: `rooms: [4]` matches a 5-room listing; `maxTotal` fades a cell whose every listing is over budget but leaves its `median` unchanged; choosing `rooms: [2]` changes a mixed cell's `median` to the 2-room median.
- [ ] **Step 2:** Run `npm test`. Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test`. Expected: passed.
- [ ] **Step 5:** Commit: `feat: filter and cell logic`.

### Task 9: The map

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/useData.ts`, `web/src/Map.tsx`, `web/src/copy.ts`, `web/src/styles.css`

**Interfaces:**
- Consumes: `cellStats`, `listFor`, `Filters`, `MapListing`, `Meta`, format helpers.
- Produces: `<Map listings filters tagged={MapListing[]} hotId onHot(id | null) onPick(id) onDistrict(name | null) onBounds(bounds) />`; `useData(): { state: 'loading' | 'error' | 'ready'; listings: MapListing[]; meta: Meta | null }`.

Decisions:

- Base style: OpenFreeMap "positron", recoloured to the prototype's palette (land `#e6ebed`, water `#b4d0dc`, parks `#bcd8b7`). Start view: centre 26.10, 44.435, zoom 11.2; max bounds a little beyond the city.
- Cells: one GeoJSON fill layer built with `cellToBoundary`. Colour ramp over 1 200 to 4 500 €/m² through `#2f7f86`, `#8dbfa8`, `#f2d58a`, `#e98b5b`, `#b23a5e`. Opacity 0.75; faded cells 0.08. Thin cells are a pale grey hatch and their tooltip says "prea puține anunțuri".
- Metro lines in their OSM colours with white station dots; parks from the reference file, above the cells.
- `tagged` listings are white price tags (`185k`) outlined `#1b7a50` when `delta <= -5`, `#b0413a` when `delta >= 5`, else `#4a5361`; all other listed apartments are small grey dots. The hot tag is filled dark with white text and drawn on top.
- Hover (tap on touch) a cell: tooltip with `eurM2(median)`, district, `n` listings. Click a cell: `onDistrict` with its district, or `null` when it is already selected.
- Legend bottom-left titled "Preț cerut pe m²". Under it, when `meta.placed < meta.total`: "Poziții exacte pentru X% din anunțuri. Harta se completează la fiecare colectare."
- States from `useData`: loading shows the base map with "Se încarcă anunțurile…"; error shows "Nu am putut încărca datele. Rulează `npm run collect` și reîncarcă pagina."; `updatedAt` older than 3 days shows "Date vechi: actualizate pe {dată}".

- [ ] **Step 1:** Scaffold the Vite + React app; `npm run dev` serves an empty page with the title "Unde am putea locui?".
- [ ] **Step 2:** Implement `useData`, `copy.ts`, the map with base style, cells, metro, parks, legend and the three states, with `NO_FILTERS`.
- [ ] **Step 3:** Add tags, dots, hover tooltip and cell click.
- [ ] **Step 4: Verify in the browser** at 1440×900: cells are coloured across the city, the north reads more expensive than the south-west, the tooltip shows a real district name, the console has no errors. Rename `listings.json` temporarily and confirm the error state, then restore it.
- [ ] **Step 5:** Screenshot to Cosmin. Commit: `feat: price map with real data`.

### Task 10: The filter panel

**Files:**
- Create: `web/src/Panel.tsx`
- Modify: `web/src/App.tsx`, `web/src/styles.css`, `web/src/copy.ts`

**Interfaces:**
- Produces: `<Panel filters onChange(filters) count total children />` where `children` is the list from Task 11.
- Filter state lives in `App` and is mirrored to the URL query string so a filtered view can be shared and survives reload.

Controls and labels: "Buget total" (slider, 40 000 to 500 000 €, step 5 000, "oricât" at the top end); "Preț maxim pe m²" (1 200 to 4 600, step 100); "Camere" (toggle buttons `1`, `2`, `3`, `4+`); "Suprafață minimă" (20 to 150 m², step 5); "Construit după" (choices: oricând, 1977, 1990, 2010, 2020); "Metrou la cel mult" (5 to 25 min); checkbox "Parc la cel mult 15 minute"; checkbox "Ascunde ansamblurile noi". A "Șterge filtrele" button appears when any filter is set. Header line: "{count} din {total} apartamente se potrivesc".

- [ ] **Step 1: Design checkpoint.** Seven filters do not fit the prototype's header. Build two layouts of the filter area behind a temporary switch: (a) the three most-used filters visible (buget, camere, metrou) with the rest under "Mai multe filtre"; (b) all filters in a scrolling section above the list with a sticky header. Screenshot both to Cosmin and wait for his choice.
- [ ] **Step 2:** Keep the chosen layout, delete the other and the switch.
- [ ] **Step 3: Verify in the browser:** each control changes the map (cells fade or recolour as Task 8 defines); reload keeps the filters; "Șterge filtrele" restores everything; keyboard focus is visible on every control.
- [ ] **Step 4:** Commit: `feat: filter panel`.

### Task 11: The apartment list, phone layout, and handover

**Files:**
- Create: `web/src/Card.tsx`, `README.md`
- Modify: `web/src/Panel.tsx`, `web/src/App.tsx`, `web/src/styles.css`, `web/src/copy.ts`

**Interfaces:**
- Consumes: `listFor`, `Map`'s `onBounds`, `onHot`, `onPick`, `tagged`.

Decisions:

- The list is `listFor(listings, filters, bounds)`, shown 50 at a time with "Arată încă 50". `tagged` passed to the map is exactly the cards currently rendered.
- Card: `eur(total)` large; `deltaText` coloured as the tag outline; "{camere}, {m2} m², etaj {floor}, {year}" using "Garsonieră" for one room and "parter" for floor 0, leaving out unknown parts; `eurM2(ppm)`; "{n} min până la metrou {name}, {n} min până la {park}"; labels "ansamblu nou" and "poziție aproximativă" when they apply; a link "Vezi pe Storia" opening in a new tab, and "Mai apare în {n} anunțuri" listing `also` links when present.
- Hovering a card calls `onHot`; picking a tag scrolls its card into view and marks it.
- District bar above the list when `filters.district` is set: "Doar {district}" with a button "Arată toate zonele".
- Empty state: "Nimic nu se potrivește aici" with "Mărește bugetul, permite un drum mai lung până la metrou sau micșorează harta." When a district is selected: "Nimic nu se potrivește în {district}" with the "Arată toate zonele" button.
- Under 860 px: one pane at a time with a two-option switch "Listă" / "Hartă" fixed at the bottom; tapping a tag switches to the list at that card.
- Long titles wrap to two lines then truncate.

- [ ] **Step 1:** Implement the card, list, paging, district bar and empty states.
- [ ] **Step 2:** Wire card and tag highlighting both ways.
- [ ] **Step 3:** Implement the phone layout.
- [ ] **Step 4: Verify in the browser.** Desktop 1440×900: pan the map and the list changes; hover a card and its tag highlights; click a tag and the list scrolls; click a cell and only that district is listed; set a 40 000 € budget and the empty state appears; "Vezi pe Storia" opens the real listing. Phone 375×812: the switch works and a tag tap lands on its card. Console has no errors.
- [ ] **Step 5: Write `README.md`** in plain language: what the project is, the two commands (`npm run collect`, `npm run dev`) with one line each, how long a collection takes, and that the first few collections fill in positions gradually.
- [ ] **Step 6:** Run `npm test` and `npm run build`. Expected: all tests pass, build succeeds.
- [ ] **Step 7:** Screenshots (desktop and phone) to Cosmin. Commit: `feat: apartment list and phone layout`.
