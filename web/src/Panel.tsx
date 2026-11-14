import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { copy } from './copy';
import { YEARS } from './filterUrl';
import { area, eur, eurM2, filterSummary, grouped, minutes, placeName } from './format';
import { NO_FILTERS, type Filters } from './logic';
import { parseLimit, RANGES } from './sliders';

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  count: number;
  total: number;
  // Matches without a map position, and how to list them.
  unplacedCount: number;
  onUnplaced: () => void;
  // How many of the matches sit in the visible part of the map, once the list follows it; null otherwise.
  inView: number | null;
  onCity: () => void;
  // Neighbourhood names for the picker, in the chosen sector when there is one.
  districts: string[];
  // Phones only: the filters fold away behind one button so the apartments start on the first screen.
  open: boolean;
  onOpen: (open: boolean) => void;
  // Every collected apartment, placed or not, and when the data was collected.
  allCount: number;
  updatedAt: string | null;
  stale: boolean;
  // Moves keyboard focus to the first price tag on the map.
  onMap: () => void;
  // Wide screens only: the panel folded down to its title and count.
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  children?: ReactNode;
};

type SliderProps = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | null;
  // Which end of the track means "no limit": the top for maximums, the bottom for minimums.
  open: 'min' | 'max';
  format: (n: number) => string;
  anyText: string;
  onChange: (value: number | null) => void;
  // Money limits can also be typed, since a slider step of 5 000 € is too coarse for a budget.
  typed?: boolean;
};

function Typed({ id, label, value, min, max, step, open, format, anyText, onChange }: SliderProps & { id: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const v = parseLimit(draft, { min, max, step, open });
      if (v !== undefined) onChange(v);
    }
    setDraft(null);
  };
  return (
    <input
      className={`typed${value === null ? ' unset' : ''}`}
      inputMode="numeric"
      aria-label={label}
      aria-describedby={id}
      value={draft ?? (value === null ? anyText : format(value))}
      onFocus={(e) => {
        setDraft(value === null ? '' : String(value));
        // Selecting a field that has already lost focus (fast Tab) would pull focus back to it.
        const field = e.target;
        requestAnimationFrame(() => document.activeElement === field && field.select());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function Slider(props: SliderProps) {
  const { label, min, max, step, value, open, format, anyText, onChange, typed } = props;
  const id = useId();
  // A typed limit can sit between steps or beyond the track; the thumb then rests at the nearest point.
  const pos = Math.min(max, Math.max(min, value ?? (open === 'max' ? max : min)));
  const text = value === null ? anyText : format(value);
  const fill = ((pos - min) / (max - min)) * 100;
  // Invisible copies of the longest values reserve their width, so the label never moves while dragging.
  const sizers = [format(min), format(max), anyText];
  return (
    <div className={`field${value === null ? '' : ' set'}`}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        {typed ? (
          <Typed {...props} id={id} />
        ) : (
        <output htmlFor={id} aria-live="off" className={value === null ? 'unset' : undefined}>
          {sizers.map((t) => (
            <span key={t} className="sizer" aria-hidden="true">
              {t}
            </span>
          ))}
          <span>{text}</span>
        </output>
        )}
      </div>
      <input
        id={id}
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={pos}
        aria-valuetext={text}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v === (open === 'max' ? max : min) ? null : v);
        }}
      />
    </div>
  );
}

function Rooms({ value, onChange }: { value: number[]; onChange: (rooms: number[]) => void }) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <span id={id}>{copy.rooms}</span>
      </div>
      <div className="toggles" role="group" aria-labelledby={id}>
        {[1, 2, 3, 4].map((r) => {
          const on = value.includes(r);
          return (
            <button
              key={r}
              type="button"
              className="toggle"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r].sort((a, b) => a - b))}
            >
              {r === 4 ? '4+' : r}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Sectors({ value, onChange }: { value: string | null; onChange: (sector: string | null) => void }) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <span id={id}>{copy.sector}</span>
      </div>
      <div className="toggles joined" role="group" aria-labelledby={id}>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const sector = `Sectorul ${n}`;
          const on = value === sector;
          return (
            <button key={n} type="button" className="toggle" aria-pressed={on} aria-label={sector} onClick={() => onChange(on ? null : sector)}>
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Same model as rooms and sector: nothing pressed means any year, pressing the chosen year again clears it.
function Years({ value, onChange }: { value: number | null; onChange: (year: number | null) => void }) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <span id={id}>{copy.builtAfter}</span>
      </div>
      <div className="toggles joined" role="group" aria-labelledby={id}>
        {YEARS.map((y) => {
          const on = value === y;
          return (
            <button key={y} type="button" className="toggle" aria-pressed={on} onClick={() => onChange(on ? null : y)}>
              {y}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// The keyboard and phone route to what clicking a map cell does.
function District({ value, options, onChange }: { value: string | null; options: string[]; onChange: (district: string | null) => void }) {
  const id = useId();
  return (
    <div className={`field${value === null ? '' : ' set'}`}>
      <div className="field-head">
        <label htmlFor={id}>{copy.district}</label>
      </div>
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{copy.anyDistrict}</option>
        {value !== null && !options.includes(value) && <option value={value}>{placeName(value)}</option>}
        {options.map((d) => (
          <option key={d} value={d}>
            {placeName(d)}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// How many filters are on, for the phone's filter button. The district is shown in the list instead.
export function activeCount(f: Filters): number {
  return (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => k !== 'district' && JSON.stringify(f[k]) !== JSON.stringify(NO_FILTERS[k])).length;
}

// Filters behind "more filters" on a wide screen; the ones that change prices and flat type stay in view.
const SECONDARY: (keyof Filters)[] = ['minYear', 'hideNewDev', 'sector', 'maxMetroMin', 'district', 'parkWithin15'];

export function Panel({ filters, onChange, onMap, count, total, allCount, updatedAt, stale, unplacedCount, onUnplaced, inView, onCity, districts, open, onOpen, collapsed, onCollapse, children }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const f = filters;
  const anySet = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const active = activeCount(f);
  const hiddenActive = SECONDARY.filter((k) => JSON.stringify(f[k]) !== JSON.stringify(NO_FILTERS[k])).length;
  // Opens by itself only for filters that live in it; a picked district already has its own bar above the list.
  const [more, setMore] = useState(() => SECONDARY.some((k) => k !== 'district' && JSON.stringify(f[k]) !== JSON.stringify(NO_FILTERS[k])));
  const filtersId = useId();
  const moreId = useId();
  // Once the filters scroll out of sight, the header carries a one-line summary of what is on.
  const filtersRef = useRef<HTMLElement>(null);
  const [filtersHidden, setFiltersHidden] = useState(false);
  useEffect(() => {
    const el = filtersRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setFiltersHidden(!e.isIntersecting), { root: el.closest('.panel'), rootMargin: '-120px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const summary = filterSummary(f);

  // Wide screens fold the extra filters away; phones always show them inside the filter panel.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 861px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Folding: the panel is trimmed down to its header (a clip-path from the full card to the header's box), then switches
  // to the folded layout, which is exactly that box. Unfolding plays the same trim in reverse after the panel is back.
  const asideRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const folding = useRef(false);
  const trimmed = () => {
    const panel = asideRef.current;
    const head = headRef.current;
    return panel && head ? `inset(0 0 ${Math.max(0, panel.clientHeight - head.offsetHeight)}px 0 round 14px)` : null;
  };
  const fold = () => {
    const panel = asideRef.current;
    const to = trimmed();
    if (collapsed || !panel || !to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return onCollapse(!collapsed);
    if (folding.current) return;
    folding.current = true;
    panel.scrollTo({ top: 0 });
    const run = panel.animate([{ clipPath: 'inset(0 0 0 0 round 14px)' }, { clipPath: to }], { duration: 240, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', fill: 'forwards' });
    run.onfinish = () => {
      folding.current = false;
      // Render the folded layout before letting go of the trim, so the full panel never flashes for a frame.
      flushSync(() => onCollapse(true));
      run.cancel();
    };
  };
  const wasCollapsed = useRef(collapsed);
  useLayoutEffect(() => {
    const opened = wasCollapsed.current && !collapsed;
    wasCollapsed.current = collapsed;
    const panel = asideRef.current;
    if (!opened || !panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = trimmed();
    if (!from) return;
    panel.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0 round 14px)' }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }, [collapsed]);

  return (
    <aside ref={asideRef} className={`panel${open ? ' filters-open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <a
        className="skip"
        href="#harta"
        onClick={(e) => {
          e.preventDefault();
          onMap();
        }}
      >
        {copy.skipToMap}
      </a>
      <div ref={headRef} className="panel-head">
        {/* The button sits beside the title so the count line has the full width to itself. */}
        <div className="title-row">
          <h1 className="panel-title">{copy.title}</h1>
          {/* Always rendered and only hidden, so the header keeps its size when it appears. */}
          <div className="title-actions">
            <button type="button" className="fold" aria-expanded={!collapsed} aria-label={collapsed ? copy.panelOpen : copy.panelFold} title={collapsed ? copy.panelOpen : copy.panelFold} onClick={fold}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d={collapsed ? 'M6 2.75v10.5M8.5 6.5 10 8l-1.5 1.5' : 'M6 2.75v10.5M10 6.5 8.5 8 10 9.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
        {/* On a phone only this bar stays pinned while the title scrolls away. */}
        <div className="panel-bar">
          <p className="count" aria-live="polite">
            <strong>
              {!anySet
                ? copy.matchAllBoth(grouped(allCount), grouped(count))
                : f.maxMetroMin !== null || f.parkWithin15
                  ? copy.matchWalking(grouped(count), grouped(unplacedCount))
                  : copy.matchBoth(grouped(count + unplacedCount), grouped(count))}
            </strong>
          </p>
          {anySet && !(collapsed && wide) && (
            <button type="button" className="link-button clear-link" onClick={() => onChange(NO_FILTERS)}>
              {copy.clearFilters}
            </button>
          )}
          <button
            type="button"
            className="filters-toggle"
            aria-expanded={open}
            aria-controls={filtersId}
            onClick={() => {
              onOpen(!open);
              if (open) return;
              // From anywhere down the list: bring the filters into view and put the keyboard on the first one.
              requestAnimationFrame(() => {
                const top = filtersRef.current;
                const panel = top?.closest<HTMLElement>('.panel');
                if (!top || !panel) return;
                panel.scrollTo({ top: 0 });
                top.querySelector<HTMLElement>('input, button, select')?.focus({ preventScroll: true });
              });
            }}
          >
            <span>{copy.filtersLabel}</span>
            {active > 0 && <span className="badge">{active}</span>}
          </button>
        </div>
        {(inView !== null || unplacedCount > 0 || updatedAt !== null) && (
          <div className="panel-notes">
            {inView !== null && (
              <p>
                {copy.inViewLine(grouped(inView))}{' '}
                <button type="button" className="link-button" onClick={onCity}>
                  {copy.wholeCity}
                </button>
              </p>
            )}
            {unplacedCount > 0 && (
              <p className="unplaced-line">
                <button type="button" className="link-button soft" onClick={onUnplaced}>
                  {f.maxMetroMin !== null || f.parkWithin15 ? copy.unplacedLineWalking(grouped(unplacedCount)) : copy.unplacedLine(grouped(unplacedCount))}
                </button>
              </p>
            )}
            {updatedAt !== null && <p className={stale ? 'stale' : undefined}>{stale ? copy.stale(updatedAt) : copy.dataFrom(updatedAt)}</p>}
          </div>
        )}
        {(filtersHidden || collapsed) && summary !== null && (
          <p className="summary">
            <span>{summary}</span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                if (collapsed) onCollapse(false);
                if (!open) onOpen(true);
                filtersRef.current?.closest('.panel')?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
              }}
            >
              {copy.modify}
            </button>
          </p>
        )}
      </div>
      <section id={filtersId} ref={filtersRef} className="panel-top" aria-label={copy.filtersLabel}>
        <div className="group">
          <Slider label={copy.budget} {...RANGES.maxTotal} value={f.maxTotal} format={eur} anyText={copy.anyAmount} onChange={(maxTotal) => set({ maxTotal })} typed />
          <Slider label={copy.maxPpm} {...RANGES.maxPpm} value={f.maxPpm} format={eurM2} anyText={copy.anyAmount} onChange={(maxPpm) => set({ maxPpm })} typed />
          <Rooms value={f.rooms} onChange={(rooms) => set({ rooms })} />
          <Slider label={copy.minM2} {...RANGES.minM2} value={f.minM2} format={area} anyText={copy.anyArea} onChange={(minM2) => set({ minM2 })} />
        </div>
        <button type="button" className="more-toggle" aria-expanded={more} aria-controls={moreId} onClick={() => setMore(!more)}>
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {more ? copy.fewerFilters : copy.moreFilters}
          {!more && hiddenActive > 0 && <span className="badge">{hiddenActive}</span>}
        </button>
        {/* The extra filters open by growing their row (a grid track from 0fr to 1fr), so the list below moves instead of jumping. */}
        <div className={`more-wrap${more ? ' open' : ''}`} inert={!more && wide ? true : undefined}>
        <div id={moreId} className="group more-filters">
          <div className="wide">
            <Years value={f.minYear} onChange={(minYear) => set({ minYear })} />
          </div>
          <div className="wide">
            <Sectors value={f.sector} onChange={(sector) => set({ sector })} />
          </div>
          <div className="wide">
            <Slider label={copy.metro} {...RANGES.maxMetroMin} value={f.maxMetroMin} format={(n) => `~${minutes(n)}`} anyText={copy.anyAmount} onChange={(maxMetroMin) => set({ maxMetroMin })} />
            {f.maxMetroMin !== null && <p className="hint">{copy.walkHint}</p>}
          </div>
          <div className="wide">
            <District value={f.district} options={districts} onChange={(district) => set({ district })} />
          </div>
          <Check label={copy.hideNewDev} checked={f.hideNewDev} onChange={(hideNewDev) => set({ hideNewDev })} />
          <Check label={copy.park} checked={f.parkWithin15} onChange={(parkWithin15) => set({ parkWithin15 })} />
        </div>
        </div>
      </section>
      <div className="panel-list">{children}</div>
    </aside>
  );
}
