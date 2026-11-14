import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy } from './copy';
import { fromQuery, toQuery } from './filterUrl';
import { eur, grouped } from './format';
import { List, PAGE, type Picked } from './List';
import { cellStats, CITY_DOMAIN, colourDomain, districtFitsSector, listFor, matchCount, type Filters } from './logic';
import { Map as MapView, type Bounds } from './Map';
import { Panel } from './Panel';
import { useData } from './useData';
import type { MapListing } from '../../shared/types';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;
// Hovering a card re-renders the app; the map only needs to follow its own props.
const Map = memo(MapView);

export function App() {
  const { state, listings, meta } = useData();
  const [filters, setFilters] = useState<Filters>(() => fromQuery(window.location.search));
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [hotId, setHotId] = useState<string | null>(null);
  const [pick0, setPicked] = useState<{ id: string; list: MapListing[] } | null>(null);
  const [pane, setPane] = useState<'list' | 'map'>('list');

  const list = useMemo(() => (bounds ? listFor(listings, filters, bounds) : []), [listings, filters, bounds]);
  // Paging belongs to one list: a new list (filters changed, map moved) starts again at one page.
  const [paging, setPaging] = useState({ list, shown: PAGE });
  const shown = paging.list === list ? paging.shown : PAGE;
  const tagged = useMemo(() => list.slice(0, shown), [list, shown]);
  // Like paging, the mark belongs to the list it was made in.
  const picked: Picked | null = pick0 !== null && pick0.list === list ? pick0 : null;
  const latest = useRef({ list, shown });
  latest.current = { list, shown };

  const { count, total } = useMemo(() => matchCount(listings, filters), [listings, filters]);
  const stats = useMemo(() => cellStats(listings, filters), [listings, filters]);
  const domain = useMemo(() => colourDomain(stats, filters), [stats, filters]);

  // Choosing a sector that does not hold the chosen district drops the district.
  const changeFilters = (next: Filters) => {
    const keep = next.district === null || next.sector === null || next.sector === filters.sector || districtFitsSector(listings, next.district, next.sector);
    setFilters(keep ? next : { ...next, district: null });
  };

  // The same rule, once, for a district and sector restored together from the URL.
  useEffect(() => {
    if (state !== 'ready') return;
    setFilters((f) => (f.district !== null && f.sector !== null && !districtFitsSector(listings, f.district, f.sector) ? { ...f, district: null } : f));
  }, [state, listings]);

  useEffect(() => {
    const q = toQuery(filters);
    // Safari throws after about 100 calls in 30 seconds; dragging a slider gets there, and the URL is only a convenience.
    try {
      window.history.replaceState(null, '', q ? `?${q}` : window.location.pathname);
    } catch {
      // Keep going with the old URL.
    }
  }, [filters]);

  const pick = useCallback((id: string) => {
    const { list: current, shown: now } = latest.current;
    const i = current.findIndex((l) => l.id === id);
    if (i < 0) return;
    setPaging({ list: current, shown: Math.max(now, Math.ceil((i + 1) / PAGE) * PAGE) });
    setPicked({ id, list: current });
    setPane('list');
  }, []);
  const pickDistrict = useCallback((district: string | null) => setFilters((f) => ({ ...f, district })), []);

  // colourDomain hands back the fixed range itself when a sector has too few cells to compare.
  const relative = filters.sector !== null && domain !== CITY_DOMAIN ? filters.sector : null;
  const legendTitle = relative === null ? copy.legendTitle : copy.legendTitleIn(relative);
  const stale = meta !== null && Date.now() - new Date(meta.updatedAt).getTime() > STALE_MS;
  const coverage = meta !== null && meta.placed < meta.total ? copy.coverage(grouped(meta.placed), grouped(meta.total)) : null;

  return (
    <main className={`app pane-${pane}`}>
      <Panel filters={filters} onChange={changeFilters} count={count} total={total}>
        <List
          state={state === 'ready' && bounds === null ? 'loading' : state}
          items={list}
          shown={shown}
          onMore={() => setPaging({ list, shown: shown + PAGE })}
          hotId={hotId}
          onHot={setHotId}
          picked={picked}
          district={filters.district}
          onAllAreas={() => pickDistrict(null)}
          filters={filters}
        />
      </Panel>

      <div className="stage">
        <Map
          listings={listings}
          filters={filters}
          stats={stats}
          domain={domain}
          tagged={tagged}
          hotId={hotId}
          onHot={setHotId}
          onPick={pick}
          onDistrict={pickDistrict}
          onBounds={setBounds}
        />

        {(state !== 'ready' || stale) && (
          <div className={`notice${state === 'error' ? ' error' : ''}`} role="status">
            {state === 'loading' && copy.loading}
            {state === 'error' && (
              <>
                {copy.errorBefore}
                <code>{copy.errorCommand}</code>
                {copy.errorAfter}
              </>
            )}
            {state === 'ready' && meta && copy.stale(meta.updatedAt)}
          </div>
        )}

        <section className="legend" aria-label={legendTitle}>
          <h2 className="legend-title">{legendTitle}</h2>
          <div className="ramp" />
          <div className="ticks">
            <span>{eur(domain[0])}</span>
            <span>{eur(relative === null ? 2800 : Math.round((domain[0] + domain[1]) / 2))}</span>
            <span>{eur(domain[1])}</span>
          </div>
          {relative !== null && <p className="relative">{copy.legendRelative(relative)}</p>}
          {filters.sector !== null && relative === null && <p className="relative">{copy.legendTooFew(filters.sector)}</p>}
          {coverage !== null && <p className="coverage">{coverage}</p>}
        </section>
      </div>

      <nav className="panes" aria-label={copy.panes}>
        {(['list', 'map'] as const).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
            {p === 'list' ? copy.paneList : copy.paneMap}
          </button>
        ))}
      </nav>
    </main>
  );
}
