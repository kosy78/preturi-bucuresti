import { useEffect, useRef } from 'react';
import type { MapListing } from '../../shared/types';
import type { Filters } from './logic';
import { Card } from './Card';
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

function Content({ state, items, shown, onMore, hotId, onHot, picked, district, onAllAreas }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picked) return;
    const card = box.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(picked.id)}"]`);
    if (!card) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    card.querySelector<HTMLElement>('.card-link')?.focus({ preventScroll: true });
  }, [picked]);

  if (state === 'error') {
    return (
      <p className="list-message" role="alert">
        {copy.errorBefore}
        <code>{copy.errorCommand}</code>
        {copy.errorAfter}
      </p>
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

  if (items.length === 0) {
    return (
      <div className="empty">
        <p className="empty-title">{district === null ? copy.emptyHere : copy.emptyIn(district)}</p>
        {district === null ? (
          <p className="empty-hint">{copy.emptyHint}</p>
        ) : (
          <button type="button" className="clear" onClick={onAllAreas}>
            {copy.allAreas}
          </button>
        )}
      </div>
    );
  }

  const rest = items.length - shown;
  return (
    <div ref={box}>
      {district !== null && (
        <div className="district-bar">
          <span>{copy.districtOnly(district)}</span>
          <button type="button" className="clear" onClick={onAllAreas}>
            {copy.allAreas}
          </button>
        </div>
      )}
      <ol className="list" aria-label={copy.listLabel}>
        {items.slice(0, shown).map((l) => (
          <Card key={l.id} listing={l} hot={l.id === hotId} picked={l.id === picked?.id} onHot={onHot} />
        ))}
      </ol>
      {rest > 0 && (
        <button type="button" className="more" onClick={onMore}>
          {copy.showMore(Math.min(PAGE, rest))}
        </button>
      )}
    </div>
  );
}
