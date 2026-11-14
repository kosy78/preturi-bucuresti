import { useEffect, useRef, useState } from 'react';
import type { MapListing } from '../../shared/types';
import { basisOf, type AreaMedians, type Filters, type Order, type Relax } from './logic';
import { eur, eurM2, grouped, placeName } from './format';

const longDate = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
import { Card } from './Card';
import { Indicator } from './Indicator';
import { copy } from './copy';

export const PAGE = 50;

export type Picked = { id: string };

type Props = {
  state: 'loading' | 'error' | 'ready';
  items: MapListing[];
  shown: number;
  onMore: () => void;
  hotId: string | null;
  onHot: (id: string | null) => void;
  // A fresh object on every tag click, so picking the same tag twice scrolls again.
  picked: Picked | null;
  district: string | null;
  onAllAreas: () => void;
  filters: Filters;
  // Apartments matching the filters anywhere on the map, to tell "move the map" from "loosen a filter".
  matching: number;
  relax: Relax[];
  onRelax: (r: Relax) => void;
  onCity: () => void;
  onClear: () => void;
  // True once the user has moved the map: the list then holds only what the map shows.
  scoped: boolean;
  favs: Set<string>;
  onFav: (id: string) => void;
  onLocate: (id: string) => void;
  favCount: number;
  favOnly: boolean;
  onFavOnly: (on: boolean) => void;
  districtMedian: { median: number; n: number } | null;
  medians: AreaMedians;
  order: Order;
  onOrder: (order: Order) => void;
  unplaced: MapListing[];
  mode: 'placed' | 'unplaced' | 'areas';
  onMode: (mode: 'placed' | 'unplaced' | 'areas') => void;
  areas: { name: string; median: number; n: number; onMap: number; off: number }[];
  onArea: (name: string) => void;
  placedCount: number;
  unplacedCount: number;
  updatedAt: string | null;
  // Rank badges point at numbered map tags, so they show only when the map shows the apartments.
  showRanks: boolean;
};

export function List(props: Props) {
  const top = useRef<HTMLDivElement>(null);

  // New filters bring a new list: if it starts above the fold, bring its top back into view. Map moves leave the scroll alone.
  useEffect(() => {
    const el = top.current;
    const scroller = el?.closest<HTMLElement>('.panel');
    if (!el || !scroller) return;
    const head = scroller.querySelector<HTMLElement>('.panel-head');
    const covered = head && getComputedStyle(head).position === 'sticky' ? head.offsetHeight : 0;
    const gap = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - covered;
    if (gap < 0) scroller.scrollTop += gap;
  }, [props.filters]);

  return (
    <>
      <div ref={top} />
      <Content {...props} />
    </>
  );
}

function Content(props: Props) {
  const { state, items, shown, onMore, hotId, onHot, picked, district, onAllAreas, matching, relax, onRelax, onCity, onClear, scoped, favs, onFav, onLocate, favCount, favOnly, onFavOnly, districtMedian, medians, order, onOrder, mode, onMode, placedCount, unplacedCount, updatedAt, areas, onArea, showRanks } = props;
  const box = useRef<HTMLDivElement>(null);
  const [howOpen, setHowOpen] = useState(false);

  // Scroll and focus only for a new pick: a card filtered out and back in must not take the keyboard back.
  const handled = useRef<Picked | null>(null);
  useEffect(() => {
    if (!picked || picked === handled.current) return;
    handled.current = picked;
    const card = box.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(picked.id)}"]`);
    if (!card) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    card.querySelector<HTMLElement>('.card-link')?.focus({ preventScroll: true });
  }, [picked]);

  if (state === 'error') {
    return (
      <div className="list-message" role="alert">
        <p className="empty-title">{copy.errorTitle}</p>
        <button type="button" className="clear" onClick={() => window.location.reload()}>
          {copy.retry}
        </button>
        <p className="empty-hint">
          {copy.errorBefore}
          <code>{copy.errorCommand}</code>
          {copy.errorAfter}
        </p>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <ol className="list" aria-busy="true" aria-label={copy.loading}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="card skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </li>
        ))}
      </ol>
    );
  }

  // Rank shown on the ten best cards and on their map tags, so the two can be matched at a glance.
  const ranked = showRanks && mode === 'placed' && !favOnly && order === 'value';
  const card = (l: MapListing, i: number) => {
    const basis = basisOf(l, medians);
    // In a picked district the bar above already shows that district's median.
    const sameAsBar = district !== null && l.deltaBasis === 'district' && !l.basisEra && l.basisName === district;
    return (
      <Card key={l.id} listing={l} hot={l.id === hotId} picked={l.id === picked?.id} onHot={onHot} fav={favs.has(l.id)} onFav={onFav} onLocate={onLocate} basis={basis && !sameAsBar ? basis.median : null} rank={ranked && i < 10 ? i + 1 : null} />
    );
  };

  const tabs = favOnly ? (
    <div className="fav-head">
      <p className="scope-note">{copy.favNote}</p>
      <button type="button" className="link-button" onClick={() => onFavOnly(false)}>
        {copy.favBack}
      </button>
    </div>
  ) : (
    <div className="tabs" role="group" aria-label={copy.listLabel}>
      <Indicator active={mode} className="tab-ink" />
      {(['placed', 'unplaced', 'areas'] as const).map((m) => (
        <button key={m} type="button" className="tab" aria-pressed={mode === m} onClick={() => onMode(m)}>
          {m === 'placed' ? copy.tabPlaced : m === 'unplaced' ? copy.tabUnplaced : copy.tabAreas}
          {m !== 'areas' && <span className="tab-n">{grouped(m === 'placed' ? placedCount : unplacedCount)}</span>}
        </button>
      ))}
      {favCount > 0 && (
        <button type="button" className="tab fav-tab" aria-pressed={false} onClick={() => onFavOnly(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor" /></svg>
          {grouped(favCount)}
          <span className="sr-only">{copy.favourite}</span>
        </button>
      )}
    </div>
  );

  const how = howOpen && updatedAt !== null && <p className="how">{copy.howText(longDate.format(new Date(updatedAt)))}</p>;

  const head = (
    <div className="list-head">
      <span className="sort-prefix" aria-hidden="true">{copy.sortPrefix}</span>
      <div className="sort" role="group" aria-label={copy.sortLabel}>
        <Indicator active={order} className="sort-thumb" />
        {(['value', 'price'] as const).map((o) => (
          <button key={o} type="button" className="sort-option" aria-pressed={order === o} onClick={() => onOrder(o)}>
            {o === 'value' ? copy.sortValue : copy.sortPrice}
          </button>
        ))}
      </div>
      <div className="list-head-actions">
        {updatedAt !== null && (
          <button type="button" className="info" aria-expanded={howOpen} aria-label={copy.howShort} title={copy.howShort} onClick={() => setHowOpen(!howOpen)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 7.2v4M8 4.7v.1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        )}

      </div>
    </div>
  );

  const walkingOn = props.filters.maxMetroMin !== null || props.filters.parkWithin15;
  const unplacedNote = mode === 'unplaced' && !favOnly && (
    <p className="scope-note">
      {copy.unplacedHint}
      {walkingOn && ` ${copy.unplacedWalking}`}
    </p>
  );

  const bar = district !== null && !favOnly && (
    <div className="district-bar">
      <div>
        <p className="district-name">{copy.districtOnly(placeName(district))}</p>
        {districtMedian && <p className="district-stats">{copy.medianLine(eurM2(Math.round(districtMedian.median)), copy.cellCount(districtMedian.n))}</p>}
      </div>
      <button type="button" className="clear" onClick={onAllAreas}>
        {copy.allAreas}
      </button>
    </div>
  );

  if (mode === 'areas' && !favOnly) {
    return (
      <>
        {bar}
        {tabs}
        <p className="scope-note">{copy.areasNote}</p>
        <ol className="areas">
          {areas.map((a) => (
            <li key={a.name}>
              <button type="button" className="area" onClick={() => onArea(a.name)}>
                <span className="area-name">
                  {placeName(a.name)}
                </span>
                <span className="area-median">{eurM2(Math.round(a.median))}</span>
                <span className="area-meta">{copy.areaCounts(grouped(a.onMap), grouped(a.off), grouped(a.n))}</span>
              </button>
            </li>
          ))}
        </ol>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {bar}
        {(favOnly || matching > 0 || unplacedCount > 0) && tabs}
        {(favOnly || matching > 0 || unplacedCount > 0) && head}
        {how}
        <div className="empty">
          {favOnly ? (
            <>
              <p className="empty-title">{copy.favEmpty}</p>
              <button type="button" className="clear" onClick={() => onFavOnly(false)}>
                {copy.favBack}
              </button>
            </>
          ) : (
            <>
              <p className="empty-title">{district !== null ? copy.emptyIn(placeName(district)) : mode === 'unplaced' ? copy.unplacedNone : matching > 0 ? copy.emptyHere : copy.emptyAll}</p>
              {district !== null || mode === 'unplaced' ? null : matching > 0 ? (
                <>
                  <p className="empty-hint">{copy.emptyZoom}</p>
                  <button type="button" className="clear" onClick={onCity}>
                    {copy.cityView}
                  </button>
                </>
              ) : relax.length > 0 ? (
                <>
                  <p className="empty-hint">{copy.relaxTitle}</p>
                  <div className="relax">
                    {relax.slice(0, 3).map((r) => (
                      <button key={r.key} type="button" className="clear" onClick={() => onRelax(r)}>
                        {r.value !== undefined ? copy.relaxTo[r.key](r.key === 'maxTotal' ? eur(r.value) : eurM2(r.value)) : copy.relax[r.key]}
                        <span className="relax-n">{copy.relaxCount(r.count)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="empty-hint">{copy.emptyHint}</p>
                  <button type="button" className="clear" onClick={onClear}>
                    {copy.clearFilters}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  const rest = items.length - shown;
  return (
    <div ref={box}>
      {bar}
      {tabs}
      {head}
      {how}
      {unplacedNote}
      <ol className="list" aria-label={copy.listLabel}>
        {items.slice(0, shown).map(card)}
      </ol>
      {rest > 0 && (
        <button type="button" className="more" onClick={onMore}>
          {copy.showMore(Math.min(PAGE, rest))}
        </button>
      )}
    </div>
  );
}
