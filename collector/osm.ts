import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { areaM2, type Boundaries, type LngLat, type MultiPolygon, type Named, type NamedPolygon } from './geo';

type Log = (line: string) => void;
type Tags = Record<string, string>;
type Geometry = { lat: number; lon: number }[];
export type OsmElement =
  | { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
  | { type: 'way'; id: number; geometry: Geometry; tags?: Tags }
  | { type: 'relation'; id: number; members: { type: string; ref: number; role: string; geometry?: Geometry }[]; tags?: Tags };

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const METRO_PATH = 'web/public/data/metro.geojson';
const PARKS_PATH = 'web/public/data/parks.geojson';
const BOUNDARIES_PATH = 'web/public/data/boundaries.geojson';
const BBOX = '44.33,25.95,44.55,26.25';
const QUERY = `[out:json][timeout:180];
(
  node["station"="subway"](${BBOX});
  way["leisure"="park"]["name"](${BBOX});
  relation["leisure"="park"]["name"](${BBOX});
  relation["route"="subway"](${BBOX});
);
out geom;`;
const RETRY_WAIT_MS = 60_000;
const MIN_PARK_M2 = 10_000;

const round = (n: number) => Math.round(n * 1e5) / 1e5;
const lngLat = (g: Geometry): LngLat[] => g.map(({ lon, lat }) => [round(lon), round(lat)]);

export function toMetro(elements: OsmElement[]) {
  // OSM splits interchanges into one node per line ("Piața Unirii 1", "Piața Unirii 2"); riders see one station.
  const stations = new Map<string, LngLat[]>();
  for (const e of elements) {
    if (e.type !== 'node' || e.tags?.station !== 'subway' || !e.tags.name) continue;
    const name = e.tags.name.replace(/ [12]$/, '');
    stations.set(name, [...(stations.get(name) ?? []), [e.lon, e.lat]]);
  }

  // Each line has one relation per direction and branch; their union is the line as drawn.
  const lines = new Map<string, { colour: string; ways: Map<number, LngLat[]> }>();
  for (const e of elements) {
    if (e.type !== 'relation' || e.tags?.type !== 'route' || e.tags.route !== 'subway' || !e.tags.ref) continue;
    const line = lines.get(e.tags.ref) ?? { colour: e.tags.colour ?? '', ways: new Map() };
    for (const m of e.members) if (m.type === 'way' && m.geometry) line.ways.set(m.ref, lngLat(m.geometry));
    lines.set(e.tags.ref, line);
  }

  return {
    type: 'FeatureCollection',
    features: [
      ...[...stations].map(([name, pts]) => ({
        type: 'Feature',
        properties: { kind: 'station', name },
        geometry: {
          type: 'Point',
          coordinates: [round(avg(pts.map((p) => p[0]))), round(avg(pts.map((p) => p[1])))],
        },
      })),
      ...[...lines].sort(([a], [b]) => a.localeCompare(b)).map(([name, { colour, ways }]) => ({
        type: 'Feature',
        properties: { kind: 'line', name, colour },
        geometry: { type: 'MultiLineString', coordinates: [...ways.values()] },
      })),
    ],
  };
}

export function toParks(elements: OsmElement[]) {
  const parks: NamedPolygon[] = [];
  for (const e of elements) {
    const name = e.tags?.name;
    if (!name || e.tags?.leisure !== 'park') continue;
    let ring: LngLat[] | undefined;
    if (e.type === 'way') ring = closed(lngLat(e.geometry)) ? lngLat(e.geometry) : undefined;
    if (e.type === 'relation') {
      const outers = e.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry);
      ring = largest(stitch(outers.map((m) => lngLat(m.geometry!))));
    }
    if (ring && areaM2(ring) >= MIN_PARK_M2) parks.push({ name, ring });
  }
  return {
    type: 'FeatureCollection',
    features: parks.map(({ name, ring }) => ({
      type: 'Feature',
      properties: { name },
      geometry: { type: 'Polygon', coordinates: [ring] },
    })),
  };
}

const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];
const closed = (line: LngLat[]) => line.length >= 4 && same(line[0], line[line.length - 1]);

// A multipolygon's outer boundary may be cut into several ways that only form rings once joined end to end.
function stitch(pieces: LngLat[][]): LngLat[][] {
  const open = pieces.filter((p) => p.length >= 2);
  const rings: LngLat[][] = [];
  while (open.length) {
    let ring = open.shift()!;
    let grew = true;
    while (!closed(ring) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        const end = ring[ring.length - 1];
        if (same(end, p[0])) ring = [...ring, ...p.slice(1)];
        else if (same(end, p[p.length - 1])) ring = [...ring, ...p.slice(0, -1).reverse()];
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (closed(ring)) rings.push(ring);
  }
  return rings;
}

function largest(rings: LngLat[][]): LngLat[] | undefined {
  return rings.sort((a, b) => areaM2(b) - areaM2(a))[0];
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export async function runOsm(
  log: Log,
  fetchImpl: typeof fetch = fetch,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  let elements: OsmElement[] | undefined;
  for (let attempt = 0; !elements; attempt++) {
    try {
      const res = await fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: { 'User-Agent': 'bucharest-price-map/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: QUERY }),
      });
      if (!res.ok) throw new Error(`Overpass answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
      elements = ((await res.json()) as { elements: OsmElement[] }).elements;
    } catch (e) {
      if (attempt >= 2) {
        log(`Oprit: OpenStreetMap nu a răspuns (${e instanceof Error ? e.message : String(e)}).`);
        throw e;
      }
      log('OpenStreetMap nu a răspuns; reîncerc peste un minut.');
      await sleep(RETRY_WAIT_MS);
    }
  }

  const metro = toMetro(elements);
  const parks = toParks(elements);
  for (const [path, data] of [[METRO_PATH, metro], [PARKS_PATH, parks]] as const) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data) + '\n');
  }
  const stations = metro.features.filter((f) => f.properties.kind === 'station').length;
  log(`Gata: ${stations} stații de metrou, ${metro.features.length - stations} linii, ${parks.features.length} parcuri.`);
}

type Collection = { features: { properties: { kind?: string; name: string }; geometry: { coordinates: unknown } }[] };
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Collection;

export function loadStations(path = METRO_PATH): Named[] {
  return read(path)
    .features.filter((f) => f.properties.kind === 'station')
    .map((f) => ({ name: f.properties.name, at: f.geometry.coordinates as LngLat }));
}

export function loadParks(path = PARKS_PATH): NamedPolygon[] {
  return read(path).features.map((f) => ({ name: f.properties.name, ring: (f.geometry.coordinates as LngLat[][])[0] }));
}

export function loadBoundaries(path = BOUNDARIES_PATH): Boundaries {
  const features = read(path).features;
  const city = features.find((f) => f.properties.kind === 'city');
  if (!city) throw new Error(`${path} has no city outline`);
  return {
    city: city.geometry.coordinates as MultiPolygon,
    sectors: features
      .filter((f) => f.properties.kind === 'sector')
      .map((f) => ({ name: f.properties.name, area: f.geometry.coordinates as MultiPolygon })),
  };
}
