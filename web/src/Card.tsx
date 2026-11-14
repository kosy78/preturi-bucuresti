import { memo, type PointerEvent } from 'react';
import type { MapListing } from '../../shared/types';
import { copy } from './copy';
import { isUnusual } from './logic';
import { deltaText, eur, eurM2, facts, siteName, sourceName, tone, walks } from './format';

type Props = {
  listing: MapListing;
  hot: boolean;
  picked: boolean;
  onHot: (id: string | null) => void;
};

export const Card = memo(function Card({ listing: l, hot, picked, onHot }: Props) {
  const walk = walks(l);
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
        <span className="card-price">{eur(l.total)}</span>
        <span className="card-ppm">{eurM2(l.ppm)}</span>
      </div>
      {l.delta !== null && <p className={`card-delta ${isUnusual(l) ? 'muted' : tone(l)}`}>{deltaText(l)}</p>}
      {isUnusual(l) && <p className="card-unusual">{copy.unusual}</p>}
      <p className="card-facts">{facts(l)}</p>
      <p className="card-title">{l.title}</p>
      {walk && <p className="card-walk">{walk}</p>}
      {(l.isNewDev || !l.precise) && (
        <p className="card-labels">
          {l.isNewDev && <span>{copy.newDev}</span>}
          {!l.precise && <span>{copy.approximate}</span>}
        </p>
      )}
      {main && (
        <a className="card-link" href={l.url} target="_blank" rel="noopener noreferrer">
          {copy.seeOn(sourceName(l.id))}
        </a>
      )}
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
