import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { copy } from './copy';
import { fromQuery, toQuery } from './filterUrl';
import { eur, grouped, kindLabel, placeName } from './format';
import { List, PAGE, type Picked } from './List';
import { Card } from './Card';
import { Sheet, type SheetHandle } from './Sheet';
import { areaMedians, basisOf, cellStats, CITY_DOMAIN, colourDomain, districtFitsSector, byOrder, favouritesFor, flagUnusual, listFromSorted, matchCount, matches, mergeTwins, NO_FILTERS, relaxations, trustLocations, unplacedFromSorted, type Filters, type Order } from './logic';
import { CITY, Map as MapView, type Bounds, type MapLayer } from './Map';
import { Indicator } from './Indicator';
import { activeCount, Panel } from './Panel';
import { useData } from './useData';
import type { MapListing } from '../../shared/types';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;
const FAVS_KEY = 'favorite-apartments';
const COLLAPSED_KEY = 'panel-collapsed';
// The floating panel's width plus its gap from the screen edge and from the map content beside it (see styles.css).
const PANEL_INSET = 440 + 16 + 8;
const narrow = () => window.matchMedia('(max-width: 860px)').matches;

function loadFavs(): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
// Hovering a card re-renders the app; the map only needs to follow its own props.
const Map = memo(MapView);

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d={down ? 'M4 1v5.5M1.5 4.2 4 6.7l2.5-2.5' : 'M4 7V1.5M1.5 3.8 4 1.3l2.5 2.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function App() {
  const { state, listings: raw, meta } = useData();
  // From every listing, as the collector does, so the medians shown are exactly the ones compared against.
  const medians = useMemo(() => areaMedians(raw), [raw]);
  const listings = useMemo(() => flagUnusual(mergeTwins(trustLocations(raw)), medians), [raw, medians]);
  // Neighbourhoods with enough listings to trust their median (the same 15 the comparisons and the table use).
  const areaStats = useMemo(() => new globalThis.Map([...medians.district].filter(([, s]) => s.n >= 15)), [medians]);
  const [order, setOrder] = useState<Order>(() => (new URLSearchParams(window.location.search).get('ordine') === 'pret' ? 'price' : 'value'));
  const [filters, setFilters] = useState<Filters>(() => fromQuery(window.location.search));
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [hotId, setHotId] = useState<string | null>(null);
  const [pick0, setPicked] = useState<Picked | null>(null);
  const [pane, setPane] = useState<'list' | 'map'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Bumped to send the map back to the whole city.
  const [cityKey, setCityKey] = useState(0);
  // Until the user moves the map, the list covers the whole city: on a phone the map is not even on screen.
  const [scoped, setScoped] = useState(false);
  const [favs, setFavs] = useState(loadFavs);
  const [favOnly, setFavOnly] = useState(false);
  // Which apartments the list holds: those on the map, or the matches still without a position.
  const [mode, setMode] = useState<'placed' | 'unplaced' | 'areas'>('placed');
  const [focus, setFocus] = useState<{ id: string; gentle?: boolean } | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [mapLayer, setMapLayer] = useState<MapLayer>(() => {
    const v = new URLSearchParams(window.location.search).get('harta');
    return v === 'hexagoane' ? 'cells' : v === 'cartiere' ? 'areas' : 'all';
  });
  // Wide screens float the panel over the map; it can fold down to a small card to give the map the whole screen.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [wide, setWide] = useState(() => !narrow());
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)');
    const on = () => setWide(!mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const collapse = (on: boolean) => {
    setCollapsed(on);
    try {
      localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0');
    } catch {
      // Remembered only for this visit.
    }
  };
  const inset = wide && !collapsed ? PANEL_INSET : 0;
  // The sheet exists only on phone widths; widening the window closes it rather than leaving it hidden but focused.
  useEffect(() => {
    if (!wide) return;
    // The apartment open in the phone sheet becomes the picked card in the wide list.
    if (sheetId !== null) setPicked({ id: sheetId });
    closeSheet(false);
  }, [wide]);
  const collapseRef = useRef(collapse);
  collapseRef.current = collapse;
  const opener = useRef<HTMLElement | null>(null);
  const sheetClose = useRef<HTMLButtonElement>(null);
  const sheetApi = useRef<SheetHandle>(null);
  // Closing by Escape or a tap on the map slides the sheet out first; leaving the map closes it at once.
  const dismissSheet = () => (sheetApi.current ? sheetApi.current.dismiss() : closeSheet());
  useEffect(() => {
    if (sheetId === null) return;
    sheetClose.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissSheet();
    setHotId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetId]);

  // The apartments on the map that pass the filters, in the visible area once the map has been moved.
  // The list does not wait for the map: until the map reports its view, it covers the whole city.
  // The map's view matters only once the list follows it; until then a pan or zoom must not rebuild the list
  // (that would reset its paging and drop the picked card).
  const view = scoped && bounds ? bounds : CITY;
  // Sorted once per order; every filter step then only filters (same result, no re-sorting 16 000 listings).
  const sorted = useMemo(() => [...listings].sort(byOrder(order)), [listings, order]);
  const placed = useMemo(() => listFromSorted(sorted, filters, view), [sorted, filters, view]);
  const unplaced = useMemo(() => (state === 'ready' ? unplacedFromSorted(sorted, filters) : []), [state, sorted, filters]);
  // Favourites are the shortlist: all of them, placed or not, whatever the filters or the map show.
  const favList = useMemo(() => (favOnly ? favouritesFor(listings, favs, order) : []), [favOnly, listings, favs, order]);
  const list = favOnly ? favList : mode === 'unplaced' ? unplaced : placed;
  // Neighbourhood table: each district's median (the one cards compare against) and how many of its flats match.
  const areas = useMemo(() => {
    if (mode !== 'areas') return [];
    const anyArea = { ...filters, district: null };
    const onMap = new globalThis.Map<string, number>();
    const off = new globalThis.Map<string, number>();
    const inSector = new Set<string>();
    const noWalking = { ...anyArea, maxMetroMin: null, parkWithin15: false };
    for (const l of listings) {
      if (l.district === null) continue;
      if (filters.sector === null || l.sector === filters.sector) inSector.add(l.district);
      if (l.lat !== null && matches(l, anyArea)) onMap.set(l.district, (onMap.get(l.district) ?? 0) + 1);
      if (l.lat === null && matches(l, noWalking)) off.set(l.district, (off.get(l.district) ?? 0) + 1);
    }
    return [...medians.district]
      .filter(([name, s]) => s.n >= 15 && inSector.has(name))
      .map(([name, s]) => ({ name, median: s.median, n: s.n, onMap: onMap.get(name) ?? 0, off: off.get(name) ?? 0 }))
      .sort((a, b) => a.median - b.median);
  }, [mode, listings, filters, medians]);
  // Paging belongs to one list: a new list (filters changed, map moved) starts again at one page.
  const [paging, setPaging] = useState({ list, shown: PAGE });
  const shown = paging.list === list ? paging.shown : PAGE;
  // Tags always come from apartments with a position: the shown part of the list, or the first page on the map.
  // Price tags stay the first page of the list (as the legend says); a later card hovered or picked gets its tag while it is.
  const tagBase = useMemo(() => (list === unplaced ? placed : list).filter((l) => l.lat !== null), [list, unplaced, placed]);
  const firstPage = useMemo(() => tagBase.slice(0, PAGE), [tagBase]);
  // The same array while nothing extra needs a tag, so hovering a card does not resend every dot to the map.
  const tagged = useMemo(() => {
    const extra = [hotId, pick0?.id, focus?.id, sheetId].map((id) => id !== null && id !== undefined && !firstPage.some((l) => l.id === id) && tagBase.find((l) => l.id === id)).filter((l): l is MapListing => !!l);
    return extra.length > 0 ? [...firstPage, ...extra] : firstPage;
  }, [tagBase, firstPage, hotId, pick0, focus, sheetId]);
  // The mark stays while its apartment is in the list shown.
  const picked: Picked | null = pick0 !== null && list.some((l) => l.id === pick0.id) ? pick0 : null;
  const latest = useRef({ list, shown, placed, mode, favOnly });
  latest.current = { list, shown, placed, mode, favOnly };

  const { count, total } = useMemo(() => matchCount(listings, filters), [listings, filters]);
  const relax = useMemo(() => (count === 0 ? relaxations(listings, filters) : []), [count, listings, filters]);
  // The map's cells follow the filters a beat behind while a slider is dragged, so the slider itself stays smooth.
  const lagFilters = useDeferredValue(filters);
  const stats = useMemo(() => cellStats(listings, lagFilters), [listings, lagFilters]);
  // Colours follow the same (deferred) filters as the cells they paint, so switching sector never flashes the old range.
  const domain = useMemo(() => colourDomain(stats, lagFilters), [stats, lagFilters]);

  // Choosing a sector that does not hold the chosen district drops the district.
  const changeFilters = (next: Filters) => {
    const keep = next.district === null || next.sector === null || next.sector === filters.sector || districtFitsSector(listings, next.district, next.sector);
    setFilters(keep ? next : { ...next, district: null });
  };

  // Once the data is in, a district from the URL must be a real one (any letter case), and fit the sector restored with it.
  useEffect(() => {
    if (state !== 'ready') return;
    setFilters((f) => {
      if (f.district === null) return f;
      const wanted = f.district.toLowerCase();
      const real = listings.find((l) => l.district !== null && l.district.toLowerCase() === wanted)?.district ?? null;
      const district = real !== null && (f.sector === null || districtFitsSector(listings, real, f.sector)) ? real : null;
      return district === f.district ? f : { ...f, district };
    });
  }, [state, listings]);

  useEffect(() => {
    const q = [toQuery(filters), order === 'price' ? 'ordine=pret' : '', mapLayer === 'cells' ? 'harta=hexagoane' : mapLayer === 'areas' ? 'harta=cartiere' : ''].filter(Boolean).join('&');
    // Written once the filters settle: a slider drag would otherwise rewrite the URL dozens of times (and Safari throws
    // after about 100 calls in 30 seconds). The URL is only a convenience.
    const t = setTimeout(() => {
      try {
        window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
      } catch {
        // Keep going with the old URL.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [filters, order, mapLayer]);

  const pick = useCallback((id: string) => {
    const { list: current, shown: now, placed: onMap, mode: m, favOnly: fav } = latest.current;
    // A tag picked while the list shows something else (unplaced, neighbourhoods, favourites without it)
    // brings back the list of apartments on the map, where it is.
    const inCurrent = m !== 'areas' && current.some((l) => l.id === id);
    const target = inCurrent ? current : onMap;
    const i = target.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (!inCurrent) {
      setMode('placed');
      if (fav) setFavOnly(false);
    }
    // A tag picked while the panel is folded opens it, so the card can be seen.
    if (!narrow()) collapseRef.current(false);
    setPaging({ list: target, shown: Math.max(inCurrent ? now : PAGE, Math.ceil((i + 1) / PAGE) * PAGE) });
    // On a phone the tapped apartment opens over the map instead of sending you back to the list.
    if (narrow()) {
      opener.current = document.activeElement as HTMLElement | null;
      setSheetId(id);
      setFocus({ id, gentle: true });
      return;
    }
    setPicked({ id });
    setPane('list');
  }, []);
  const toggleFav = useCallback((id: string) => {
    setFavs((old) => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(FAVS_KEY, JSON.stringify([...next]));
      } catch {
        // Favourites then last only for this visit.
      }
      return next;
    });
  }, []);
  const locate = useCallback((id: string) => {
    // The map now shows this apartment; a card picked earlier must not stay marked as if it were the chosen one.
    setPicked(null);
    setFocus({ id });
    setPane('map');
    // The button that asked is now hidden on a phone; the keyboard moves to the apartment's tag.
    setTimeout(() => document.querySelector<HTMLElement>('.tag.selected')?.focus({ preventScroll: true }), 600);
  }, []);
  // restore: give focus back to the tag that opened the sheet; not when leaving the map, where it would be hidden.
  const closeSheet = useCallback((restore = true) => {
    setSheetId(null);
    setFocus(null);
    const back = opener.current;
    opener.current = null;
    if (restore && back?.isConnected) back.focus({ preventScroll: true });
  }, []);
  const openFilters = () => {
    setFiltersOpen(true);
    setPane('list');
    setSheetId(null);
    // After the pane switch, bring the filters into view and put the keyboard on the first one.
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.panel');
      panel?.scrollTo({ top: 0 });
      panel?.querySelector<HTMLElement>('.panel-top input, .panel-top button')?.focus({ preventScroll: true });
    });
  };
  const toCity = () => {
    setScoped(false);
    setCityKey((k) => k + 1);
  };
  const onUserMove = useCallback(() => setScoped(true), []);
  const sheet = sheetId === null ? null : (listings.find((l) => l.id === sheetId) ?? null);
  // Saved apartments that are no longer in the data (sold, merged as a repost) are kept but not counted.
  const favCount = useMemo(() => listings.reduce((n, l) => n + (favs.has(l.id) ? 1 : 0), 0), [listings, favs]);
  const districtMedian = filters.district === null ? null : (medians.district.get(filters.district) ?? null);
  const pickDistrict = useCallback((district: string | null) => setFilters((f) => ({ ...f, district })), []);

  // colourDomain hands back the fixed range itself when a sector has too few cells to compare.
  // By neighbourhood the colours come from unfiltered medians, so their range must not move with the filters either.
  const areaDomain = useMemo((): [number, number] => {
    if (lagFilters.sector === null) return CITY_DOMAIN;
    const values = stats.flatMap((c) => (c.sector === lagFilters.sector && c.district !== null && areaStats.has(c.district) ? [areaStats.get(c.district)!.median] : []));
    if (values.length < 2) return CITY_DOMAIN;
    const min = Math.floor(Math.min(...values) / 50) * 50;
    const max = Math.ceil(Math.max(...values) / 50) * 50;
    return min === max ? CITY_DOMAIN : [min, max];
  }, [stats, lagFilters.sector, areaStats]);
  const shownDomain = mapLayer === 'areas' ? areaDomain : domain;
  const relative = lagFilters.sector !== null && shownDomain !== CITY_DOMAIN ? lagFilters.sector : null;
  const kind = kindLabel(filters);
  const legendTitle = mapLayer === 'areas' ? copy.legendAreas : (relative === null ? copy.legendTitle : copy.legendTitleIn(relative)) + (kind ? ` · ${kind}` : '');
  const stale = meta !== null && Date.now() - new Date(meta.updatedAt).getTime() > STALE_MS;
  const active = activeCount(filters);
  const districts = useMemo(() => {
    const names = new Set<string>();
    for (const l of listings) if (l.district !== null && l.lat !== null && (filters.sector === null || l.sector === filters.sector)) names.add(l.district);
    return [...names].sort((a, b) => placeName(a).localeCompare(placeName(b), 'ro'));
  }, [listings, filters.sector]);

  return (
    <main className={`app pane-${pane}${collapsed ? ' panel-collapsed' : ''}`}>
      <Panel filters={filters} onChange={changeFilters} count={count} total={total} allCount={listings.length} updatedAt={meta?.updatedAt ?? null} stale={stale} onMap={() => {
        setPane('map');
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.tag[tabindex="0"]')?.focus());
      }} unplacedCount={unplaced.length} onUnplaced={() => { setFavOnly(false); setMode('unplaced'); }} inView={scoped && !favOnly && filters.district === null && placed.length !== count ? placed.length : null} onCity={toCity} districts={districts} open={filtersOpen} onOpen={setFiltersOpen} collapsed={collapsed} onCollapse={collapse}>
        <List
          state={state}
          items={list}
          shown={shown}
          onMore={() => setPaging({ list, shown: shown + PAGE })}
          hotId={hotId}
          onHot={setHotId}
          picked={picked}
          district={filters.district}
          onAllAreas={() => pickDistrict(null)}
          filters={filters}
          matching={count}
          mode={mode}
          onMode={setMode}
          placedCount={placed.length}
          unplacedCount={unplaced.length}
          relax={relax}
          onRelax={(r) => changeFilters({ ...filters, [r.key]: r.value ?? NO_FILTERS[r.key] })}
          onCity={toCity}
          onClear={() => changeFilters(NO_FILTERS)}
          scoped={scoped}
          favs={favs}
          onFav={toggleFav}
          onLocate={locate}
          favCount={favCount}
          favOnly={favOnly}
          onFavOnly={setFavOnly}
          districtMedian={districtMedian}
          medians={medians}
          order={order}
          onOrder={setOrder}
          unplaced={unplaced}
          updatedAt={meta?.updatedAt ?? null}
          showRanks={mapLayer === 'all'}
          areas={areas}
          onArea={(name) => {
            setMode('placed');
            changeFilters({ ...filters, district: name });
          }}
        />
      </Panel>

      <div className="stage" id="harta">
        <Map
          listings={listings}
          filters={lagFilters}
          stats={stats}
          domain={shownDomain}
          tagged={tagged}
          hotId={hotId}
          onHot={setHotId}
          onPick={pick}
          onDistrict={pickDistrict}
          onBounds={setBounds}
          onUserMove={onUserMove}
          onBackground={() => dismissSheet()}
          cityKey={cityKey}
          inset={inset}
          focus={focus}
          ranked={!favOnly && mode !== 'unplaced' && order === 'value' && mapLayer === 'all'}
          layer={mapLayer}
          areas={areaStats}
        />

        {/* Prices without the apartments: the hexagons alone, or coloured by each neighbourhood's median from every listing. */}
        <div className="map-layers" role="group" aria-label={copy.layersLabel}>
          <Indicator active={mapLayer} className="sort-thumb" />
          {(['all', 'cells', 'areas'] as const).map((k) => (
            <button key={k} type="button" className="sort-option" aria-pressed={mapLayer === k} onClick={() => setMapLayer(k)}>
              {k === 'all' ? copy.layerAll : k === 'cells' ? copy.layerCells : copy.layerAreas}
            </button>
          ))}
        </div>

        {sheet && (
          <Sheet ref={sheetApi} id={sheet.id} closeRef={sheetClose} onClose={() => closeSheet()}>
            <ul className="list">
              <Card listing={sheet} hot={false} picked={false} onHot={() => {}} fav={favs.has(sheet.id)} onFav={toggleFav} onLocate={() => {}} basis={basisOf(sheet, medians)?.median ?? null} inSheet />
            </ul>
          </Sheet>
        )}

        {/* Phones only: what the list header says, kept in reach while the map is showing. */}
        <div className="map-bar">
          {/* Tapping the count leads to the apartments the map cannot show yet. */}
          <button type="button" className="map-count" onClick={() => { setMode('unplaced'); setPane('list'); }}>
            {scoped && placed.length !== count ? copy.mapHere(grouped(placed.length), grouped(count)) : copy.mapOfAll(grouped(count), grouped(count + unplaced.length))}
          </button>
          {scoped && placed.length !== count && (
            <button type="button" className="chip" onClick={toCity}>
              {copy.wholeCity}
            </button>
          )}
          {filters.district !== null && (
            <button type="button" className="chip" onClick={() => pickDistrict(null)} aria-label={copy.clearDistrict(placeName(filters.district))}>
              {placeName(filters.district)}
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          )}
          <button
            type="button"
            className="chip filters-chip"
            onClick={openFilters}
          >
            {copy.filtersLabel}
            {active > 0 && <span className="badge">{active}</span>}
          </button>
        </div>

        {(state !== 'ready' || stale || (count === 0 && (!wide || collapsed))) && (
          <div className={`notice${state === 'error' ? ' error' : ''}`} role="status">
            {state === 'loading' && copy.loading}
            {state === 'error' && copy.errorTitle}
            {state === 'ready' && count === 0 && unplaced.length === 0 && copy.emptyMap}
            {state === 'ready' && count === 0 && unplaced.length > 0 && (
              <>
                {copy.emptyMapUnplaced(grouped(unplaced.length))}{' '}
                <button type="button" className="link-button" onClick={() => { setMode('unplaced'); setPane('list'); collapse(false); }}>
                  {copy.seeThem}
                </button>
              </>
            )}
            {state === 'ready' && count > 0 && meta && copy.stale(meta.updatedAt)}
          </div>
        )}

        <section className={`legend${legendOpen ? ' open' : ''}${count === 0 ? ' idle' : ''}${mapLayer === 'all' ? '' : ' prices-only-legend'}`} aria-label={legendTitle}>
          <div className="legend-head">
            <h2 className="legend-title">{legendTitle}</h2>
            <button type="button" className="link-button legend-toggle" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)}>
              {legendOpen ? copy.legendLess : copy.legendMore}
            </button>
          </div>
          <div className="ramp" />
          <div className="ticks">
            <span>{eur(shownDomain[0])}</span>
            <span>{eur(relative === null ? 2800 : Math.round((shownDomain[0] + shownDomain[1]) / 2))}</span>
            <span>{eur(shownDomain[1])}</span>
          </div>
          {relative !== null && <p className="relative">{copy.legendRelative(relative)}</p>}
          {lagFilters.sector !== null && relative === null && <p className="relative">{copy.legendTooFew(lagFilters.sector)}</p>}
          {/* The tags always get a short key: their outline is the main value signal on the map. */}
          {mapLayer === 'all' && <p className="legend-sub">{copy.keyTagsTitle}</p>}
          <ul className={`tag-key${mapLayer === 'all' ? '' : ' off'}`}>
            <li><span className="key-tag deep"><Arrow down />95k</span>{copy.keyDeepShort}</li>
            <li><span className="key-tag under"><Arrow down />95k</span>{copy.keyUnderShort}</li>
            <li><span className="key-tag near">95k</span>{copy.keyNearShort}</li>
            <li><span className="key-tag over"><Arrow />95k</span>{copy.keyOverShort}</li>
          </ul>
          <ul className="key">
            <li className="tags-only"><span className="key-tag none">95k</span>{copy.keyNone}</li>
            <li className="tags-only"><span className="key-swatch collapsed" />{copy.keyCollapsed}</li>
            <li><span className="key-swatch thin" />{copy.keyThin}</li>
            <li><span className="key-swatch faded" />{copy.keyFaded}</li>
            <li className="tags-only"><span className="key-swatch dot" />{copy.keyDots}</li>
          </ul>
          <p className="key-hint">{copy.keyHint}</p>
        </section>
      </div>

      <nav className="panes" aria-label={copy.panes}>
        {(['list', 'map'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={pane === p}
            onClick={() => {
              setPane(p);
              closeSheet(false);
            }}
          >
            {p === 'list' ? copy.paneList : copy.paneMap}
          </button>
        ))}
      </nav>
    </main>
  );
}
