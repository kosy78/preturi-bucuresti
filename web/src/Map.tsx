import { cellToBoundary } from 'h3-js';
import type { Feature, FeatureCollection } from 'geojson';
import { Map as MapLibre, Marker, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type LayerSpecification, type MapLayerMouseEvent, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapListing } from '../../shared/types';
import { copy } from './copy';
import { eur, eurM2, thousands, tone } from './format';
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
};

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const LAND = '#e6ebed';
const WATER = '#b4d0dc';
const PARK = '#bcd8b7';
const INK = '#20242c';
const LABEL = '#5b6b76';
const CELL_LAYERS = ['cells', 'cells-thin'];
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const CITY: Bounds = [25.85, 44.28, 26.36, 44.6];

const RAMP = ['#2f7f86', '#8dbfa8', '#f2d58a', '#e98b5b', '#b23a5e'];

// The five colours spread evenly across the domain.
function ramp([min, max]: [number, number]): ExpressionSpecification {
  return ['interpolate', ['linear'], ['get', 'median'], ...RAMP.flatMap((colour, i) => [min + ((max - min) * i) / (RAMP.length - 1), colour])] as ExpressionSpecification;
}

const cellOpacity = ['case', ['get', 'faded'], 0.08, 0.75] as const;

const ourLayers = {
  cells: [
    {
      id: 'cells', type: 'fill', source: 'cells', filter: ['!', ['get', 'thin']],
      paint: {
        'fill-color': ramp(CITY_DOMAIN),
        'fill-opacity': cellOpacity,
      },
    },
    { id: 'cells-thin', type: 'fill', source: 'cells', filter: ['get', 'thin'], paint: { 'fill-pattern': 'hatch', 'fill-opacity': cellOpacity } },
    { id: 'cells-edge', type: 'line', source: 'cells', paint: { 'line-color': LAND, 'line-width': 1, 'line-opacity': ['case', ['get', 'faded'], 0.3, 1] } },
  ],
  parks: [{ id: 'parks', type: 'fill', source: 'parks', paint: { 'fill-color': PARK, 'fill-opacity': 0.85 } }],
  top: [
    { id: 'cell-hover', type: 'line', source: 'cells', filter: ['==', ['get', 'cell'], ''], paint: { 'line-color': INK, 'line-width': 1.5 } },
    {
      id: 'metro-lines', type: 'line', source: 'metro', filter: ['==', ['get', 'kind'], 'line'],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5], 'line-opacity': 0.85 },
    },
    {
      id: 'metro-stations', type: 'circle', source: 'metro', filter: ['==', ['get', 'kind'], 'station'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5], 'circle-color': '#fff', 'circle-stroke-color': INK, 'circle-stroke-width': 1.5 },
    },
    {
      id: 'dots', type: 'circle', source: 'dots',
      paint: { 'circle-radius': 2.5, 'circle-color': '#44505a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1, 'circle-opacity': 0.7, 'circle-stroke-opacity': 0.7 },
    },
  ],
} as unknown as Record<'cells' | 'parks' | 'top', LayerSpecification[]>;

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
      Object.assign(l.paint, { 'text-color': src === 'water_name' ? '#4f7385' : LABEL, 'text-halo-color': LAND, 'text-halo-width': 1.2, 'text-halo-blur': 0 });
      // Local names, so the city reads "București" rather than the English name.
      (l.layout as Record<string, unknown>)['text-field'] = ['get', 'name'];
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
      cells: { type: 'geojson', data: EMPTY },
      dots: { type: 'geojson', data: EMPTY },
      parks: { type: 'geojson', data: '/data/parks.geojson' },
      metro: { type: 'geojson', data: '/data/metro.geojson' },
    },
    layers: [...below, ...roads, ...ourLayers.cells, ...water, ...ourLayers.parks, ...ourLayers.top, ...labels],
  };
}

function hatch(): ImageData {
  const size = 16;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  ctx.fillStyle = '#e9edef';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#bcc5ca';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function cellFeatures(stats: CellStat[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stats.map((s) => ({
      type: 'Feature',
      properties: s,
      geometry: { type: 'Polygon', coordinates: [cellToBoundary(s.cell, true)] },
    })),
  };
}

type Tip = { x: number; y: number; cell: CellStat };

export function Map({ listings, filters, stats, domain, tagged, hotId, onHot, onPick, onDistrict, onBounds }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const markers = useRef(new globalThis.Map<string, Marker>());
  const latest = useRef({ filters, hotId, onHot, onPick, onDistrict, onBounds });
  latest.current = { filters, hotId, onHot, onPick, onDistrict, onBounds };
  const [ready, setReady] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);

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
          center: [26.1, 44.435],
          zoom: 11.2,
          minZoom: 10,
          maxZoom: 17,
          maxBounds: [[CITY[0], CITY[1]], [CITY[2], CITY[3]]],
          fadeDuration: reduced ? 0 : 300,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
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
          m.setFilter('cell-hover', ['==', ['get', 'cell'], cell.cell]);
          setTip({ x: e.point.x, y: e.point.y, cell });
        };
        // movestart can fire before the style has loaded, when setFilter would throw.
        let loaded = false;
        const hide = () => {
          if (loaded) m.setFilter('cell-hover', ['==', ['get', 'cell'], '']);
          setTip(null);
        };
        m.on('load', () => {
          loaded = true;
          reportBounds();
          setReady(true);
        });
        m.on('movestart', hide);
        m.on('moveend', reportBounds);
        m.on('mousemove', CELL_LAYERS, (e) => {
          const cell = cellAt(e);
          m.getCanvas().style.cursor = cell && cell.district !== null && !cell.inert ? 'pointer' : '';
          show(e);
        });
        m.on('mouseleave', CELL_LAYERS, () => {
          m.getCanvas().style.cursor = '';
          hide();
        });
        m.on('click', CELL_LAYERS, (e) => {
          const cell = cellAt(e);
          if (!cell || onTag(e)) return;
          show(e);
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

  useEffect(() => {
    if (ready) mapRef.current?.getSource<GeoJSONSource>('cells')?.setData(cellFeatures(stats));
  }, [ready, stats]);

  useEffect(() => {
    if (ready) mapRef.current?.setPaintProperty('cells', 'fill-color', ramp(domain));
  }, [ready, domain[0], domain[1]]);

  useEffect(() => {
    if (!ready) return;
    const taggedIds = new Set(tagged.map((l) => l.id));
    const features: Feature[] = listings
      .filter((l) => l.lat !== null && l.lng !== null && !taggedIds.has(l.id) && matches(l, filters))
      .map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [l.lng!, l.lat!] } }));
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
      el.className = `tag ${tone(l)}`;
      el.textContent = thousands(l.total);
      el.setAttribute('aria-label', `${eur(l.total)}, ${eurM2(l.ppm)}`);
      el.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && latest.current.onHot(l.id));
      el.addEventListener('pointerleave', () => latest.current.onHot(null));
      el.addEventListener('pointercancel', () => latest.current.onHot(null));
      // Some browsers focus a tapped button; only keyboard focus should set the highlight.
      el.addEventListener('focus', () => el.matches(':focus-visible') && latest.current.onHot(l.id));
      el.addEventListener('blur', () => latest.current.onHot(null));
      el.addEventListener('click', () => latest.current.onPick(l.id));
      markers.current.set(l.id, new Marker({ element: el }).setLngLat([l.lng, l.lat]).addTo(map));
    }
  }, [ready, tagged]);

  useEffect(() => {
    for (const [id, marker] of markers.current) marker.getElement().classList.toggle('hot', id === hotId);
  }, [hotId, tagged]);

  return (
    <div className="map-wrap">
      <div ref={box} className="map" role="region" aria-label={copy.mapLabel} />
      {styleFailed && (
        <p className="map-failed" role="alert">
          {copy.basemapError}
        </p>
      )}
      {tip && (
        <div className={`tip${tip.x > (box.current?.clientWidth ?? 0) - 240 ? ' flip' : ''}`} style={{ left: tip.x, top: tip.y }}>
          {tip.cell.thin ? (
            <>
              {tip.cell.district && <strong className="tip-place">{tip.cell.district}</strong>}
              <span>{copy.cellThin}</span>
            </>
          ) : (
            <>
              <strong className="tip-price">{eurM2(tip.cell.median!)}</strong>
              <span>
                {[tip.cell.district, copy.cellCount(tip.cell.n)].filter(Boolean).join(', ')}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
