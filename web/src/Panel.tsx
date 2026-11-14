import { useId, type CSSProperties, type ReactNode } from 'react';
import { copy } from './copy';
import { YEARS } from './filterUrl';
import { area, eur, eurM2, grouped, minutes } from './format';
import { NO_FILTERS, type Filters } from './logic';
import { RANGES } from './sliders';

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  count: number;
  total: number;
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
};

function Slider({ label, min, max, step, value, open, format, anyText, onChange }: SliderProps) {
  const id = useId();
  const pos = value ?? (open === 'max' ? max : min);
  const text = value === null ? anyText : format(value);
  const fill = ((pos - min) / (max - min)) * 100;
  // Invisible copies of the longest values reserve their width, so the label never moves while dragging.
  const sizers = [format(min), format(max), anyText];
  return (
    <div className={`field${value === null ? '' : ' set'}`}>
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} aria-live="off" className={value === null ? 'unset' : undefined}>
          {sizers.map((t) => (
            <span key={t} className="sizer" aria-hidden="true">
              {t}
            </span>
          ))}
          <span>{text}</span>
        </output>
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
      <div className="toggles six" role="group" aria-labelledby={id}>
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

function Years({ value, onChange }: { value: number | null; onChange: (year: number | null) => void }) {
  const name = useId();
  const options: (number | null)[] = [null, ...YEARS];
  return (
    <fieldset className="field">
      <legend className="field-head">{copy.builtAfter}</legend>
      <div className="segments">
        {options.map((y) => (
          <label key={y ?? 'any'} className={`segment${y === null ? ' any' : ''}`}>
            <input type="radio" name={name} checked={value === y} onChange={() => onChange(y)} />
            <span>{y ?? copy.anyYear}</span>
          </label>
        ))}
      </div>
    </fieldset>
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

export function Panel({ filters, onChange, count, total, children }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const f = filters;
  const anySet = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

  return (
    <aside className="panel">
      <div className="panel-head">
        {/* The button sits beside the title so the count line has the full width to itself. */}
        <div className="title-row">
          <h1 className="panel-title">{copy.title}</h1>
          {/* Always rendered and only hidden, so the header keeps its size when it appears. */}
          <button type="button" className="clear" hidden={!anySet} onClick={() => onChange(NO_FILTERS)}>
            {copy.clearFilters}
          </button>
        </div>
        <p className="count" aria-live="polite">
          {copy.matchCount(grouped(count), grouped(total))}
        </p>
      </div>
      <section className="panel-top" aria-label={copy.filtersLabel}>
        <div className="group">
          <Slider label={copy.budget} {...RANGES.maxTotal} value={f.maxTotal} format={eur} anyText={copy.anyAmount} onChange={(maxTotal) => set({ maxTotal })} />
          <Slider label={copy.maxPpm} {...RANGES.maxPpm} value={f.maxPpm} format={eurM2} anyText={copy.anyAmount} onChange={(maxPpm) => set({ maxPpm })} />
        </div>
        <div className="group">
          <Rooms value={f.rooms} onChange={(rooms) => set({ rooms })} />
          <Slider label={copy.minM2} {...RANGES.minM2} value={f.minM2} format={area} anyText={copy.anyArea} onChange={(minM2) => set({ minM2 })} />
          <div className="wide">
            <Years value={f.minYear} onChange={(minYear) => set({ minYear })} />
          </div>
          <div className="wide">
            <Check label={copy.hideNewDev} checked={f.hideNewDev} onChange={(hideNewDev) => set({ hideNewDev })} />
          </div>
        </div>
        <div className="group">
          <Sectors value={f.sector} onChange={(sector) => set({ sector })} />
          <Slider label={copy.metro} {...RANGES.maxMetroMin} value={f.maxMetroMin} format={minutes} anyText={copy.anyAmount} onChange={(maxMetroMin) => set({ maxMetroMin })} />
          <div className="wide">
            <Check label={copy.park} checked={f.parkWithin15} onChange={(parkWithin15) => set({ parkWithin15 })} />
          </div>
        </div>
      </section>
      <div className="panel-list">{children}</div>
    </aside>
  );
}
