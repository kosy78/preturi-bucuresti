import { cellsToMultiPolygon, cellToBoundary } from 'h3-js';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibre, Marker, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type LayerSpecification, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { MapListing } from '../../shared/types';
import { copy } from './copy';
import { eurM2, placeName, tagLabel, tagTone, thousands } from './format';
import { CITY_DOMAIN, matches, type CellStat, type Filters } from './logic';

// MapLibre looks for its worker next to its own file, which the production bundle doesn't copy; point it at a bundled copy.
setWorkerUrl(workerUrl);

export type Bounds = [w: number, s: number, e: number, n: number];

type Props = {
  listings: MapListing[];
  filters: Filters;
  stats: CellStat[];
  domain: [min: number, max: number];
  tagged: MapListing[];
  hotId: string | null;
  onHot: (id: string | null) => void;
  onPick: (id: string) => void;
  onDistrict: (name: string | null) => void;
  onBounds: (bounds: Bounds) => void;
  // Called once the user drags or zooms the map, so the list can start following the view.
  onUserMove: () => void;
  // A tap on the map that hits no price tag (closes the phone's apartment sheet).
  onBackground: () => void;
  cityKey: number;
  // Pixels on the left covered by the floating panel; the map frames its views in the space beside it.
  inset: number;
  // What the map shows: everything, the price cells alone, or cells coloured by their neighbourhood's median.
  layer: MapLayer;
  areas: globalThis.Map<string, { median: number; n: number }>;
  // Whether the tags follow the value ranking, so the first ten carry their place in the list.
  ranked: boolean;
  // An apartment to centre on and mark; gentle keeps the zoom and leaves room below for the phone sheet. A fresh object each time.
  focus: { id: string; gentle?: boolean } | null;
};

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const LAND = '#e6ebed';
// Cooler and greyer than the cheap end of the price scale, so a lake never reads as a cheap area.
const WATER = '#c3cfd9';
const PARK = '#bcd8b7';
const INK = '#20242c';
const LABEL = '#5b6b76';
const CELL_LAYERS = ['cells', 'cells-thin'];
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const CITY: Bounds = [25.85, 44.28, 26.36, 44.6];

export const RAMP = ['#2f7f86', '#6fb5ae', '#e8bb5a', '#e98b5b', '#b23a5e'];
// Outside the city the map fades under a pale blue-grey veil, so the eye stays inside Bucharest.
const OUTSIDE = '#d5e0e8';

// The five colours spread evenly across the domain, applied to a cell's own median or to its neighbourhood's ('area').
function ramp([min, max]: [number, number], key: 'median' | 'area' = 'median'): ExpressionSpecification {
  // Mixed in Lab space, so the middle of the scale stays a clear sand instead of drifting to khaki.
  return ['interpolate-lab', ['linear'], ['get', key], ...RAMP.flatMap((colour, i) => [min + ((max - min) * i) / (RAMP.length - 1), colour])] as ExpressionSpecification;
}

// Faded cells stay faintly coloured so the rest of the city remains a reference while one area is lit.
const FADED = '#cdd4d8';
// Inside a neighbourhood (zoomed in) the cells thin out so streets, parks and tags take over.
const cellOpacity = ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'faded'], 0.6, 0.78], 14, ['case', ['get', 'faded'], 0.3, 0.38]] as const;
const thinOpacity = ['interpolate', ['linear'], ['zoom'], 11, ['case', ['get', 'faded'], 0.4, 0.78], 14, ['case', ['get', 'faded'], 0.25, 0.4]] as const;

// Faded cells drop their price colour for one neutral grey, so the lit area is the only coloured one.
function cellColour(domain: [number, number], key: 'median' | 'area' = 'median'): ExpressionSpecification {
  return ['case', ['get', 'faded'], FADED, ramp(domain, key)] as ExpressionSpecification;
}

export type MapLayer = 'all' | 'cells' | 'areas';

const ourLayers = {
  cells: [
    {
      id: 'cells', type: 'fill', source: 'cells', filter: ['!', ['get', 'thin']],
      paint: {
        'fill-color': cellColour(CITY_DOMAIN),
        'fill-opacity': cellOpacity,
      },
    },
    { id: 'cells-thin', type: 'fill', source: 'cells', filter: ['get', 'thin'], paint: { 'fill-pattern': 'hatch', 'fill-opacity': thinOpacity } },
    { id: 'cells-edge', type: 'line', source: 'cells', paint: { 'line-color': LAND, 'line-width': 1, 'line-opacity': ['case', ['get', 'faded'], 0.3, 1] } },
  ],
  parks: [
    { id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': PARK, 'fill-opacity': 0.85 } },
    // A darker edge keeps parks apart from the teal cells under them.
    { id: 'parks-edge', type: 'line', source: 'parks', paint: { 'line-color': '#93bb8c', 'line-width': 1 } },
  ],
  top: [
    // Driven by feature state, so hovering a cell only repaints instead of rebuilding the cell tiles.
    { id: 'cell-hover', type: 'line', source: 'cells', paint: { 'line-color': INK, 'line-width': 1.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] } },
    // A white casing keeps the yellow and orange lines visible over sand and orange cells.
    {
      id: 'metro-casing', type: 'line', source: 'metro', filter: ['==', ['get', 'kind'], 'line'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 8], 'line-opacity': 0.9 },
    },
    {
      id: 'metro-lines', type: 'line', source: 'metro', filter: ['==', ['get', 'kind'], 'line'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      // OSM's line colours, calmed to the map's chroma so the yellow and orange lines do not outshout the price colours.
      paint: {
        'line-color': ['match', ['get', 'colour'], '#FFFF00', '#d9ad00', '#FF8040', '#df7a35', '#347c11', '#3f8f3a', '#BC1725', '#b5333c', '#003399', '#244b9c', ['get', 'colour']],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 4],
      },
    },
    {
      id: 'metro-stations', type: 'circle', source: 'metro', filter: ['==', ['get', 'kind'], 'station'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5], 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': 1.5 },
    },
    {
      id: 'dots', type: 'circle', source: 'dots',
      // At city zoom the dots would speckle over the cell colours, so they fade in only once you zoom in.
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2, 15, 3.5],
        'circle-color': '#44505a',
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11.8, 0, 13, 0.75],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 11.8, 0, 13, 0.75],
      },
    },
  ],
  edges: [
    { id: 'outside', type: 'fill', source: 'boundaries', filter: ['==', ['get', 'kind'], 'outside'], paint: { 'fill-color': OUTSIDE, 'fill-opacity': 0.86 } },
    // A wide blurred band along the edge softens the veil into the city instead of a hard cut.
    {
      id: 'outside-blur', type: 'line', source: 'boundaries', filter: ['==', ['get', 'kind'], 'city'],
      paint: { 'line-color': OUTSIDE, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 14, 15, 40], 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 12, 15, 34], 'line-opacity': 0.75 },
    },
    {
      id: 'sector-edge', type: 'line', source: 'boundaries', filter: ['==', ['get', 'kind'], 'sector'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#6f7d88', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 1.4], 'line-dasharray': [3, 2.5], 'line-opacity': 0.55 },
    },
    // The neighbourhood a click would pick (hover) and the one picked, outlined from its own cells.
    { id: 'district-fill', type: 'fill', source: 'district', filter: ['==', ['get', 'kind'], 'picked'], paint: { 'fill-color': '#20242c', 'fill-opacity': 0.05 } },
    { id: 'district-hover', type: 'line', source: 'district', filter: ['==', ['get', 'kind'], 'hover'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#20242c', 'line-width': 1.6, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 } },
    { id: 'district-picked', type: 'line', source: 'district', filter: ['==', ['get', 'kind'], 'picked'], layout: { 'line-join': 'round' }, paint: { 'line-color': '#20242c', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 15, 1.6], 'line-opacity': 0.8 } },
    // The chosen sector's outline turns solid; its filter is set when a sector is picked.
    {
      id: 'sector-picked', type: 'line', source: 'boundaries', filter: ['==', ['get', 'name'], ''],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#3d4a55', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 15, 2.8], 'line-opacity': 0.85 },
    },
    {
      id: 'city-edge', type: 'line', source: 'boundaries', filter: ['==', ['get', 'kind'], 'city'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': '#3d4a55', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 15, 2.6], 'line-opacity': 0.75 },
    },
  ],
} as unknown as Record<'cells' | 'parks' | 'top' | 'edges', LayerSpecification[]>;

// Positron is a neutral grey basemap; we recolour it to the prototype's cool palette and quiet it so the price cells carry the colour.
function recolour(style: StyleSpecification): StyleSpecification {
  const hidden = new Set(['landuse_residential', 'highway-name-path', 'highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us', 'boundary_disputed']);
  const below: LayerSpecification[] = [];
  const water: LayerSpecification[] = [];
  const roads: LayerSpecification[] = [];
  const labels: LayerSpecification[] = [];
  for (const layer of style.layers) {
    if (hidden.has(layer.id)) continue;
    const l = layer as LayerSpecification & { paint: Record<string, unknown>; 'source-layer'?: string };
    l.paint ??= {};
    const src = l['source-layer'];
    if (l.type === 'background') l.paint['background-color'] = LAND;
    else if (l.id === 'park' || l.id === 'landcover_wood') l.paint['fill-color'] = PARK;
    else if (l.id === 'building') Object.assign(l.paint, { 'fill-color': '#dce2e5', 'fill-outline-color': '#d2d9dd' });
    else if (l.id === 'water') l.paint['fill-color'] = WATER;
    else if (l.id === 'waterway') l.paint['line-color'] = WATER;
    else if (l.type === 'line' && (src === 'transportation' || src === 'aeroway' || src === 'boundary')) {
      l.paint['line-opacity'] = 0.6;
      if (src === 'boundary') l.paint['line-color'] = '#c3ccd1';
      if (l.id.startsWith('railway')) l.paint['line-color'] = l.id.endsWith('dashline') ? LAND : '#d0d8dc';
    } else if (l.type === 'symbol') {
      Object.assign(l.paint, { 'text-color': src === 'water_name' ? '#4f7385' : LABEL, 'text-halo-color': LAND, 'text-halo-width': 2, 'text-halo-blur': 0 });
      // Local names, so the city reads "București" rather than the English name.
      (l.layout as Record<string, unknown>)['text-field'] = ['get', 'name'];
      // The city outline already says where Bucharest is; its big label would sit under the price tags at city zoom.
      if (l.id === 'label_city_capital' || l.id === 'label_city') l.minzoom = 14;
    }
    if (l.type === 'symbol') labels.push(l);
    else if (l.id === 'water' || l.id === 'waterway') water.push(l);
    else if (src === 'transportation' || src === 'aeroway' || src === 'boundary') roads.push(l);
    else below.push(l);
  }
  return {
    ...style,
    sources: {
      ...style.sources,
      cells: { type: 'geojson', data: EMPTY, promoteId: 'cell' },
      dots: { type: 'geojson', data: EMPTY },
      parks: { type: 'geojson', data: '/data/parks.geojson' },
      metro: { type: 'geojson', data: '/data/metro.geojson' },
      boundaries: { type: 'geojson', data: '/data/boundaries.geojson' },
      district: { type: 'geojson', data: EMPTY },
    },
    // Parks sit under the price cells (their outline stays on top), so a park never reads as a cheap cell.
    layers: [...below, ...roads, ourLayers.parks[0], ...ourLayers.cells, ...water, ourLayers.parks[1], ...ourLayers.top, ...labels, ...ourLayers.edges],
  };
}

function hatch(): ImageData {
  const size = 16;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  // Quiet on purpose: areas without enough data should recede behind the ones with prices.
  ctx.fillStyle = '#edf0f2';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#d0d7db';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

// 'area' is the cell's neighbourhood median from every listing, with or without a position; left out when unknown,
// because MapLibre drops null properties anyway.
function cellFeatures(stats: CellStat[], areas: globalThis.Map<string, { median: number; n: number }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stats.map((s) => ({
      type: 'Feature',
      properties: { ...s, ...(s.district !== null && areas.has(s.district) ? { area: areas.get(s.district)!.median, areaN: areas.get(s.district)!.n } : {}) },
      geometry: { type: 'Polygon', coordinates: [cellToBoundary(s.cell, true)] },
    })),
  };
}

type Tip = { x: number; y: number; cell: CellStat; kbd?: boolean };

// The tooltip opens to the right unless it would overflow; on a narrow map it takes whichever side has more room.
const TIP_W = 240;
function flipTip(x: number, width: number): boolean {
  return x + TIP_W > width && (x - TIP_W >= 0 || x > width / 2);
}

const DOWN = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 1v5.5M1.5 4.2 4 6.7l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const UP = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M4 7V1.5M1.5 3.8 4 1.3l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// On a phone at city zoom, only the best few tags keep their price; the rest are dots until you zoom in.
const PHONE_FULL_TAGS = 12;
const TOP_DEEP = 10;
const RANK_W = 19;

// Tags are laid out best value first: a tag that would overlap a better one shrinks to a coloured dot, so every visible price stays readable.
function layoutTags(map: MapLibre, order: MapListing[], markers: globalThis.Map<string, Marker>, sizes: globalThis.Map<string, [number, number]>, ranked: boolean) {
  const kept: [number, number, number, number][] = [];
  const container = map.getContainer();
  const { clientWidth: W, clientHeight: H } = container;
  const GAP = 3;
  // Tags under the legend cannot be seen, so they neither show nor push others aside.
  const legend = container.closest('.stage')?.querySelector('.legend')?.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  const panel = window.matchMedia('(min-width: 861px)').matches ? document.querySelector('.panel')?.getBoundingClientRect() : undefined;
  const inside = (r: DOMRect | undefined, x: number, y: number) =>
    r !== undefined && x > r.left - origin.left && x < r.right - origin.left && y > r.top - origin.top && y < r.bottom - origin.top;
  const under = (x: number, y: number) => inside(legend, x, y) || inside(panel, x, y);
  const limit = W < 600 && map.getZoom() < 12.5 ? PHONE_FULL_TAGS : Infinity;
  let rank = 0;
  for (const l of order) {
    const marker = markers.get(l.id);
    if (!marker) continue;
    const el = marker.getElement();
    // The strongest fill marks only the ten best bargains, so it still tells tags apart when every one is far under its median.
    if (el.dataset.tone === 'deep') {
      el.classList.toggle('deep', rank < TOP_DEEP);
      el.classList.toggle('under', rank >= TOP_DEEP);
    }
    const top = ranked && rank < TOP_DEEP;
    const badge = el.querySelector<HTMLElement>('.tag-rank');
    const label = top ? String(rank + 1) : '';
    if (badge && badge.textContent !== label) badge.textContent = label;
    rank += 1;
    const p = map.project(marker.getLngLat());
    // Sizes were measured without a rank badge; a ranked tag is a badge wider.
    const [w0, h] = sizes.get(l.id) ?? [44, 24];
    const w = w0 + (top ? RANK_W : 0);
    const box: [number, number, number, number] = [p.x - w / 2 - GAP, p.y - h / 2 - GAP, p.x + w / 2 + GAP, p.y + h / 2 + GAP];
    const onScreen = box[0] > 0 && box[2] < W && box[1] > 0 && box[3] < H && !under(p.x, p.y);
    const hits = (b: number[]) => kept.some((k) => b[0] < k[2] && b[2] > k[0] && b[1] < k[3] && b[3] > k[1]);
    const clash = !onScreen || kept.length >= limit || hits(box);
    // A top-ten tag that cannot fit keeps its number as a small round badge, so every numbered card still has its mark.
    const small: [number, number, number, number] = [p.x - 11, p.y - 11, p.x + 11, p.y + 11];
    const rankOnly = top && clash && onScreen && !hits(small);
    el.classList.toggle('collapsed', clash && !rankOnly);
    el.classList.toggle('rank-only', rankOnly);
    // Tags out of sight (off the map, under the panel or the legend) leave the keyboard order.
    el.tabIndex = onScreen ? 0 : -1;
    if (!clash) kept.push(box);
    else if (rankOnly) kept.push(small);
  }
}

// The middle 94% of an area's listings, so one misplaced pin cannot stretch the view across the city.
function areaBounds(listings: MapListing[], inArea: (l: MapListing) => boolean): [[number, number], [number, number]] | null {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (const l of listings) {
    if (inArea(l) && l.lat !== null && l.lng !== null) {
      lats.push(l.lat);
      lngs.push(l.lng);
    }
  }
  if (lats.length === 0) return null;
  lats.sort((a, b) => a - b);
  lngs.sort((a, b) => a - b);
  const at = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round((xs.length - 1) * q)))];
  return [[at(lngs, 0.03), at(lats, 0.03)], [at(lngs, 0.97), at(lats, 0.97)]];
}

const START = { center: [26.1, 44.435] as [number, number], zoom: 11.2 };

export function Map({ listings, filters, stats, domain, tagged, hotId, onHot, onPick, onDistrict, onBounds, onUserMove, onBackground, cityKey, inset, focus, ranked, layer, areas }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markers = useRef(new globalThis.Map<string, Marker>());
  const sizes = useRef(new globalThis.Map<string, [number, number]>());
  const latest = useRef({ filters, hotId, onHot, onPick, onDistrict, onBounds, onUserMove, onBackground, tagged, inset, ranked });
  latest.current = { filters, hotId, onHot, onPick, onDistrict, onBounds, onUserMove, onBackground, tagged, inset, ranked };
  // The view before an area (district or sector) was picked, to return to when it is cleared.
  const before = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const shownArea = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const [partial, setPartial] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const touch = window.matchMedia('(hover: none)').matches;

  useEffect(() => {
    let map: MapLibre | null = null;
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fetch(STYLE_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`${STYLE_URL}: ${r.status}`);
        return r.json() as Promise<StyleSpecification>;
      })
      .then((style) => {
        if (cancelled || !box.current) return;
        map = new MapLibre({
          container: box.current,
          style: recolour(style),
          ...START,
          minZoom: 10,
          maxZoom: 17,
          maxBounds: [[CITY[0], CITY[1]], [CITY[2], CITY[3]]],
          fadeDuration: reduced ? 0 : 300,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.setPadding({ top: 0, right: 0, bottom: 0, left: latest.current.inset });
        map.addImage('hatch', hatch(), { pixelRatio: 2 });
        const m = map;
        const reportBounds = () => {
          const b = m.getBounds();
          latest.current.onBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        };
        const onTag = (e: MapLayerMouseEvent) => (e.originalEvent.target as HTMLElement).closest('.tag') !== null;
        // Rendered features lose null properties, so restore them before anything compares against null.
        const cellAt = (e: MapLayerMouseEvent): CellStat | undefined => {
          const p = e.features?.[0]?.properties;
          return p ? ({ ...p, district: p.district ?? null, median: p.median ?? null } as CellStat) : undefined;
        };
        const show = (e: MapLayerMouseEvent) => {
          const cell = cellAt(e);
          if (!cell || onTag(e)) return hide();
          hoverCell(cell.cell);
          setTip({ x: e.point.x, y: e.point.y, cell });
        };
        let shownCell: string | null = null;
        let hovered: string | null = null;
        const hoverCell = (id: string | null) => {
          if (id === hovered) return;
          if (hovered !== null) m.setFeatureState({ source: 'cells', id: hovered }, { hover: false });
          if (id !== null) m.setFeatureState({ source: 'cells', id }, { hover: true });
          hovered = id;
        };
        // movestart can fire before the style has loaded, when touching the cell layers would throw.
        let loaded = false;
        const hide = () => {
          if (loaded) hoverCell(null);
          shownCell = null;
          setTip(null);
        };
        // Keyboard: with the map focused, the arrow keys pan it and the cell under the centre shows its details; Enter picks its district.
        const canvas = m.getCanvas();
        // Only when the keyboard brought focus here: a click or tap also focuses the map, and must keep its own tooltip.
        let byKeyboard = false;
        const onKey = () => (byKeyboard = true);
        const onPointer = () => (byKeyboard = false);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', onPointer, true);
        m.once('remove', () => {
          document.removeEventListener('keydown', onKey, true);
          document.removeEventListener('pointerdown', onPointer, true);
        });
        const inspect = () => {
          if (document.activeElement !== canvas || !loaded || !byKeyboard) return;
          const c = m.project(m.getCenter());
          const f = m.queryRenderedFeatures(c, { layers: CELL_LAYERS })[0]?.properties;
          if (!f) return hide();
          const cell = { ...f, district: f.district ?? null, median: f.median ?? null } as CellStat;
          hoverCell(cell.cell);
          setTip({ x: c.x, y: c.y, cell, kbd: true });
        };
        canvas.addEventListener('focus', () => requestAnimationFrame(inspect));
        canvas.addEventListener('blur', () => hide());
        canvas.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          const c = m.project(m.getCenter());
          const p = m.queryRenderedFeatures(c, { layers: CELL_LAYERS })[0]?.properties;
          if (!p || p.district == null || p.inert) return;
          const { filters: f, onDistrict: pickDistrict } = latest.current;
          pickDistrict(f.district === p.district ? null : String(p.district));
        });
        m.on('moveend', inspect);
        // Tiles or overlays that fail after the map has started: say so instead of leaving holes that look like data.
        // A missing tile (404) is normal at the edges of the tile set; anything else means a real gap.
        m.on('error', (e) => {
          const status = (e.error as { status?: number } | undefined)?.status;
          if (status !== 404) setPartial(true);
        });
        m.on('load', () => {
          loaded = true;
          reportBounds();
          setReady(true);
        });
        m.on('movestart', (e) => {
          hide();
          // Only gestures carry the browser event; fitBounds and easeTo calls do not.
          if ((e as { originalEvent?: Event }).originalEvent) latest.current.onUserMove();
        });
        m.on('moveend', reportBounds);
        let frame = 0;
        m.on('move', () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => layoutTags(m, latest.current.tagged, markers.current, sizes.current, latest.current.ranked));
        });
        m.on('mousemove', CELL_LAYERS, (e) => {
          const cell = cellAt(e);
          m.getCanvas().style.cursor = cell && cell.district !== null && !cell.inert ? 'pointer' : '';
          show(e);
        });
        m.on('mouseleave', CELL_LAYERS, () => {
          m.getCanvas().style.cursor = '';
          // A tap ends with a synthetic 'leave'; without hover the details stay until the next tap or a pan.
          if (!window.matchMedia('(hover: none)').matches) hide();
        });
        // Dots are apartments too: once zoomed in enough to see them, a click opens the apartment like a tag does.
        m.on('mousemove', 'dots', () => {
          if (m.getZoom() >= 12.5) m.getCanvas().style.cursor = 'pointer';
        });
        // The nearest apartment dot within a finger's reach of the click, once dots are visible.
        const dotAt = (pt: { x: number; y: number }): string | null => {
          if (m.getZoom() < 12.5) return null;
          const r = window.matchMedia('(hover: none)').matches ? 16 : 6;
          const found = m.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: ['dots'] });
          let best: string | null = null;
          let bestD = Infinity;
          for (const f of found) {
            const [lng, lat] = (f.geometry as unknown as { coordinates: [number, number] }).coordinates;
            const q = m.project([lng, lat]);
            const d = Math.hypot(q.x - pt.x, q.y - pt.y);
            if (d < bestD && f.properties?.id) [best, bestD] = [String(f.properties.id), d];
          }
          return best;
        };
        m.on('click', (e) => {
          if (onTag(e as MapLayerMouseEvent)) return;
          const dot = dotAt(e.point);
          if (dot !== null) {
            latest.current.onPick(dot);
            return;
          }
          latest.current.onBackground();
        });
        m.on('click', CELL_LAYERS, (e) => {
          const cell = cellAt(e);
          // A click on an apartment dot opens the apartment only; it must not also change the district.
          if (!cell || onTag(e) || dotAt(e.point) !== null) return;
          // Without hover, the first tap on a cell shows its details and only a second tap picks its district.
          const firstTap = window.matchMedia('(hover: none)').matches && shownCell !== cell.cell;
          show(e);
          shownCell = cell.cell;
          if (firstTap) return;
          // A cell faded by the filters or the sector stays inert, so a click cannot pick a district with nothing to list.
          if (cell.district === null || cell.inert) return;
          const { filters: f, onDistrict: pickDistrict } = latest.current;
          pickDistrict(f.district === cell.district ? null : cell.district);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStyleFailed(true);
        // Without a basemap there is no view to follow, so the list covers the whole city.
        latest.current.onBounds(CITY);
      });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      markers.current.clear();
    };
  }, []);

  // Opening or folding the panel slides the map's centre with it, so the city stays framed in the visible part.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left: inset }, duration: reduced ? 0 : 350 });
  }, [ready, inset]);

  useEffect(() => {
    if (!ready || cityKey === 0) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mapRef.current?.easeTo({ ...START, duration: reduced ? 0 : 700 });
  }, [cityKey]);

  useEffect(() => {
    if (ready) mapRef.current?.setFilter('sector-picked', ['==', ['get', 'name'], filters.sector ?? '']);
  }, [ready, filters.sector]);

  // Outline of the picked district, and of the district under the pointer, drawn from the cells that belong to it.
  const hoverDistrict = tip && !tip.cell.inert ? tip.cell.district : null;
  useEffect(() => {
    if (!ready) return;
    const outline = (name: string | null, kind: string): Feature[] => {
      if (name === null) return [];
      const cells = stats.filter((c) => c.district === name).map((c) => c.cell);
      return cells.length === 0 ? [] : [{ type: 'Feature', properties: { kind }, geometry: { type: 'MultiPolygon', coordinates: cellsToMultiPolygon(cells, true) } }];
    };
    const hover = hoverDistrict !== filters.district ? outline(hoverDistrict, 'hover') : [];
    mapRef.current?.getSource<GeoJSONSource>('district')?.setData({ type: 'FeatureCollection', features: [...outline(filters.district, 'picked'), ...hover] });
  }, [ready, stats, filters.district, hoverDistrict]);

  useEffect(() => {
    if (ready) mapRef.current?.getSource<GeoJSONSource>('cells')?.setData(cellFeatures(stats, areas));
  }, [ready, stats, areas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const byArea = layer === 'areas';
    map.setPaintProperty('cells', 'fill-color', cellColour(domain, byArea ? 'area' : 'median'));
    // By neighbourhood, a cell with few listings of its own still gets its neighbourhood's colour; only cells
    // whose neighbourhood has no median stay hatched.
    map.setFilter('cells', byArea ? ['has', 'area'] : ['!', ['get', 'thin']]);
    map.setFilter('cells-thin', byArea ? ['!', ['has', 'area']] : ['get', 'thin']);
    map.setLayoutProperty('dots', 'visibility', layer === 'all' ? 'visible' : 'none');
  }, [ready, domain[0], domain[1], layer]);

  useEffect(() => {
    if (!ready) return;
    const taggedIds = new Set(tagged.map((l) => l.id));
    const features: Feature[] = listings
      .filter((l) => l.lat !== null && l.lng !== null && !taggedIds.has(l.id) && matches(l, filters))
      .map((l) => ({ type: 'Feature', properties: { id: l.id }, geometry: { type: 'Point', coordinates: [l.lng!, l.lat!] } }));
    mapRef.current?.getSource<GeoJSONSource>('dots')?.setData({ type: 'FeatureCollection', features });
  }, [ready, listings, filters, tagged]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const keep = new Set(tagged.map((l) => l.id));
    for (const [id, marker] of markers.current) {
      if (!keep.has(id)) {
        marker.remove();
        markers.current.delete(id);
        if (id === latest.current.hotId) latest.current.onHot(null);
      }
    }
    for (const l of tagged) {
      if (markers.current.has(l.id) || l.lat === null || l.lng === null) continue;
      const el = document.createElement('button');
      el.type = 'button';
      const t = tagTone(l);
      el.className = `tag ${t}`;
      el.dataset.tone = t;
      // An arrow repeats the colour's meaning, so under and over the median read without telling green from red.
      const arrow = t === 'deep' || t === 'under' ? DOWN : t === 'over' ? UP : '';
      el.innerHTML = `<b class="tag-rank"></b>${arrow}<span>${thousands(l.total)}</span>`;
      el.setAttribute('aria-label', tagLabel(l));
      el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && latest.current.onHot(l.id));
      el.addEventListener('pointerleave', () => latest.current.onHot(null));
      el.addEventListener('pointercancel', () => latest.current.onHot(null));
      // Some browsers focus a tapped button; only keyboard focus should set the highlight.
      el.addEventListener('focus', () => el.matches(':focus-visible') && latest.current.onHot(l.id));
      el.addEventListener('blur', () => latest.current.onHot(null));
      el.addEventListener('click', () => latest.current.onPick(l.id));
      markers.current.set(l.id, new Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(map));
      sizes.current.set(l.id, [el.offsetWidth, el.offsetHeight]);
    }
    layoutTags(map, tagged, markers.current, sizes.current, ranked);
  }, [ready, tagged, ranked]);

  useEffect(() => {
    const map = mapRef.current;
    const { district, sector } = filters;
    const area = district ?? sector;
    if (!ready || !map || area === shownArea.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : 700;
    const wasNone = shownArea.current === null;
    if (area === null) {
      shownArea.current = null;
      if (before.current) map.easeTo({ ...before.current, duration });
      before.current = null;
      return;
    }
    const bounds = areaBounds(listings, district !== null ? (l) => l.district === district : (l) => l.sector === sector);
    // Not framed yet (the listings may still be loading): try again when they arrive.
    if (!bounds) return;
    shownArea.current = area;
    if (wasNone) before.current = { center: map.getCenter().toArray() as [number, number], zoom: map.getZoom() };
    const small = map.getContainer().clientWidth < 600;
    // The legend sits along the bottom, so the area is framed above it. The panel needs nothing here: fitBounds adds the map's own padding.
    const legendH = map.getContainer().closest('.stage')?.querySelector('.legend')?.getBoundingClientRect().height ?? 0;
    map.fitBounds(bounds, { padding: small ? 40 : { top: 50, right: 50, bottom: legendH + 40, left: 40 }, maxZoom: 14.5, duration });
  }, [ready, filters.district, filters.sector, listings]);

  useEffect(() => {
    for (const [id, marker] of markers.current) {
      marker.getElement().classList.toggle('hot', id === hotId);
      marker.getElement().classList.toggle('selected', id === focus?.id);
    }
  }, [hotId, tagged, focus]);

  useEffect(() => {
    const map = mapRef.current;
    const l = focus && listings.find((x) => x.id === focus.id);
    if (!ready || !map || !l || l.lat === null || l.lng === null) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const h = map.getContainer().clientHeight;
    map.easeTo({
      center: [l.lng, l.lat],
      zoom: focus!.gentle ? map.getZoom() : Math.max(map.getZoom(), 15),
      // The phone sheet covers the lower part of the map, so the apartment is placed in the upper third.
      offset: focus!.gentle ? [0, -h * 0.22] : [0, 0],
      duration: reduced ? 0 : 500,
    });
  }, [ready, focus]);

  return (
    <div className={`map-wrap${layer === 'all' ? '' : ' prices-only'}`}>
      <div ref={box} className="map" role="region" aria-label={copy.mapLabel} />
      {partial && !styleFailed && (
        <p className="map-partial" role="status">
          {copy.mapPartial}{' '}
          <button type="button" className="link-button" onClick={() => window.location.reload()}>
            {copy.retry}
          </button>
        </p>
      )}
      {styleFailed && (
        <p className="map-failed" role="alert">
          {copy.basemapError}
        </p>
      )}
      {tip?.kbd && <span className="crosshair" style={{ left: tip.x, top: tip.y }} aria-hidden="true" />}
      {tip && (
        <div
          className={`tip${flipTip(tip.x, box.current?.clientWidth ?? 0) ? ' flip' : ''}${tip.y > 140 ? ' up' : ''}`}
          style={{ left: tip.x, top: tip.y }}
          role={tip.kbd ? 'status' : undefined}
        >
          {layer === 'areas' && (tip.cell.district === null || (tip.cell as CellStat & { area?: number }).area === undefined) ? (
            <>
              {tip.cell.district && <strong className="tip-place">{placeName(tip.cell.district)}</strong>}
              <span>{copy.cellThin}</span>
            </>
          ) : layer === 'areas' ? (
            <>
              <strong className="tip-price">
                {eurM2(Math.round((tip.cell as CellStat & { area: number }).area))} <small>{copy.tipAreaMedian}</small>
              </strong>
              <span>{copy.tipAreaOf(placeName(tip.cell.district!), (tip.cell as CellStat & { areaN: number }).areaN)}</span>
            </>
          ) : tip.cell.thin || tip.cell.median === null ? (
            <>
              {tip.cell.district && <strong className="tip-place">{placeName(tip.cell.district)}</strong>}
              <span>{tip.cell.thin ? copy.cellThin : copy.cellFewOfKind(copy.cellCount(tip.cell.n))}</span>
            </>
          ) : (
            <>
              <strong className="tip-price">
                {eurM2(tip.cell.median!)} <small>{copy.tipMedian}</small>
              </strong>
              <span>
                {[tip.cell.district && placeName(tip.cell.district), copy.cellCount(tip.cell.n)].filter(Boolean).join(', ')}
              </span>
            </>
          )}
          {tip.kbd && tip.cell.district !== null && !tip.cell.inert && <span className="tip-hint">{copy.tipKeys}</span>}
          {tip.cell.district !== null && !tip.cell.inert && !touch && !tip.kbd && (
            <span className="tip-hint">{filters.district === tip.cell.district ? copy.tipAll : copy.tipOnly(placeName(tip.cell.district))}</span>
          )}
          {/* Without hover, the details come with a real button instead of a hidden second tap. */}
          {tip.cell.district !== null && !tip.cell.inert && touch && filters.district !== tip.cell.district && (
            <button type="button" className="tip-action" onClick={() => onDistrict(tip.cell.district)}>
              {copy.tipShow(placeName(tip.cell.district))}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
