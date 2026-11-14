import { memo, type PointerEvent } from 'react';
import type { MapListing } from '../../shared/types';
import { copy } from './copy';
import { isUnusual } from './logic';
import { cleanTitle, deltaText, eur, eurM2, facts, placeName, siteName, sourceName, tone, walks } from './format';

type Props = {
  listing: MapListing;
  hot: boolean;
  picked: boolean;
  onHot: (id: string | null) => void;
  fav: boolean;
  onFav: (id: string) => void;
  // Phones only: switch to the map and centre on this apartment.
  onLocate: (id: string) => void;
  // The exact median the difference was measured against; left out when the list header already shows it.
  basis: number | null;
  // Place in the list for the ten best, matching the number on their map tags.
  rank?: number | null;
  // In the phone's sheet over the map, "show on map" would do nothing.
  inSheet?: boolean;
};

export const Card = memo(function Card({ listing: l, hot, picked, onHot, fav, onFav, onLocate, basis, rank = null, inSheet = false }: Props) {
  // Walking times from a loose pin could be off by a whole neighbourhood, so they are left out.
  const walk = l.precise ? walks(l) : null;
  const ref = basis;
  const placed = l.lat !== null;
  const place = [l.district && placeName(l.district), l.sector].filter(Boolean).join(' · ') || null;
  // One apartment can be reposted many times on one site, so links are grouped by site: "Storia 1, 2, 3".
  const also = new Map<string, string[]>();
  for (const url of l.also) {
    const site = siteName(url);
    if (site) also.set(site, [...(also.get(site) ?? []), url]);
  }
  const alsoCount = [...also.values()].reduce((n, urls) => n + urls.length, 0);
  const main = siteName(l.url) !== null;
  const enter = () => onHot(l.id);
  // A tap has no hover: touch pointers never set the highlight, so it cannot stay stuck after the finger lifts.
  const point = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') enter();
  };
  const leave = () => onHot(null);

  return (
    <li
      className={`card${hot ? ' hot' : ''}${picked ? ' picked' : ''}`}
      data-id={l.id}
      onPointerEnter={point}
      onPointerLeave={leave}
      onPointerCancel={leave}
      onFocus={enter}
      onBlur={leave}
    >
      <div className="card-row">
        {rank !== null && <span className="rank" aria-label={`locul ${rank}`}>{rank}</span>}
        <span className="card-price">{eur(l.total)}</span>
        <span className="card-ppm">{eurM2(l.ppm)}</span>
        <button type="button" className={`star${fav ? ' on' : ''}`} aria-pressed={fav} aria-label={copy.favourite} onClick={() => onFav(l.id)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {l.delta !== null && (
        <p className={`card-delta ${isUnusual(l) ? 'muted' : tone(l)}`}>
          {deltaText(l)}
          {ref !== null && !isUnusual(l) && <span className="card-ref"> {copy.refMedian(eurM2(ref))}</span>}
        </p>
      )}
      {isUnusual(l) && <p className="card-unusual">{copy.unusual}</p>}
      {/* From the collector's price history: shown only once a cut has actually been recorded. */}
      {/* A cut of more than half is a corrected typo (1 190 000 to 119 000), not a discount. */}
      {l.priceDrop != null && l.priceDrop > 0 && l.priceDrop <= 50 && <p className="card-drop">{copy.priceDrop(l.priceDrop)}</p>}
      {/* Facts and place on one line; the agent's title stays available on hover. */}
      <p className="card-facts" title={l.title}>
        {facts(l)}
        <span className="card-place"> · {place ?? cleanTitle(l.title)}</span>
      </p>
      {walk && (
        <p className="card-walk">
          {walk} <span className="card-estimate">({copy.walkEstimate})</span>
        </p>
      )}
      {(l.isNewDev || !placed || !l.precise) && (
        <p className="card-labels">
          {l.isNewDev && <span>{copy.newDev}</span>}
          {!placed && <span>{copy.notOnMap}</span>}
          {placed && !l.precise && <span>{l.delta === null ? copy.approximateNoCompare : copy.approximate}</span>}
        </p>
      )}
      <div className="card-actions">
        {main && (
          <a className="card-link" href={l.url} target="_blank" rel="noopener noreferrer">
            {copy.seeOn(sourceName(l.id))}
          </a>
        )}
        {placed && !inSheet && (
          <button type="button" className="locate" onClick={() => onLocate(l.id)}>
            {copy.showOnMap}
          </button>
        )}
        {placed && l.precise && (
          <a className="route" href={`https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}&travelmode=walking`} target="_blank" rel="noopener noreferrer">
            {copy.route}
          </a>
        )}
      </div>
      {alsoCount > 0 && (
        <p className="card-also">
          {copy.alsoIn(alsoCount)}:{' '}
          {[...also].map(([site, urls], i) => (
            <span key={site}>
              {i > 0 && '; '}
              {urls.length === 1 ? (
                <a href={urls[0]} target="_blank" rel="noopener noreferrer">
                  {site}
                </a>
              ) : (
                <>
                  {site}{' '}
                  {urls.map((url, j) => (
                    <span key={url}>
                      {j > 0 && ', '}
                      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${site} ${j + 1}`}>
                        {j + 1}
                      </a>
                    </span>
                  ))}
                </>
              )}
            </span>
          ))}
        </p>
      )}
    </li>
  );
});
