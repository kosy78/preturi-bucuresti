import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Detail, SearchListing } from '../shared/types';

export type Store = {
  startSweep(): number;
  saveSearchListings(sweepId: number, ls: SearchListing[]): void;
  finishSweep(sweepId: number, ok: boolean): void;
  lastCompleteSweep(): { id: number; finishedAt: string } | null;
  listingCount(sweepId: number): number;
  needingDetail(limit: number, prioritySector?: string): { id: string; url: string }[];
  saveDetail(id: string, d: Detail | null): void;
  current(): StoredListing[];
  close(): void;
};
// peakTotal: the highest total recorded for the post, current one included.
export type StoredListing = SearchListing & Partial<Detail> & { firstSeen: string; hasDetail: boolean; peakTotal?: number };

type Row = {
  id: string;
  url: string;
  title: string;
  total: number;
  ppm: number;
  m2: number;
  rooms: number;
  floor: number | null;
  street: string | null;
  district: string | null;
  sector: string | null;
  private_owner: number;
  is_new_dev: number;
  from_price: number;
  posted_at: string;
  first_seen: string;
  list_year: number | null;
  radius_m: number | null;
  created_first: string | null;
  peak_total: number | null;
  detail_state: 'saved' | 'gone' | null;
  lat: number | null;
  lng: number | null;
  precise: number | null;
  year: number | null;
  market: 'primary' | 'secondary' | null;
};

const schema = `
  CREATE TABLE IF NOT EXISTS sweeps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    ok INTEGER
  );
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    total REAL NOT NULL,
    ppm REAL NOT NULL,
    m2 REAL NOT NULL,
    rooms INTEGER NOT NULL,
    floor INTEGER,
    street TEXT,
    district TEXT,
    sector TEXT,
    private_owner INTEGER NOT NULL,
    is_new_dev INTEGER NOT NULL,
    from_price INTEGER NOT NULL,
    posted_at TEXT NOT NULL,
    first_seen TEXT NOT NULL,
    last_sweep INTEGER NOT NULL REFERENCES sweeps(id),
    -- last_sweep moves with every sweep, even one that later fails; this only moves when a sweep completes
    complete_sweep INTEGER REFERENCES sweeps(id),
    detail_state TEXT,
    lat REAL,
    lng REAL,
    precise INTEGER,
    year INTEGER,
    market TEXT
  );
  CREATE TABLE IF NOT EXISTS price_history (
    id TEXT NOT NULL,
    sweep_id INTEGER NOT NULL,
    total REAL NOT NULL,
    ppm REAL NOT NULL,
    PRIMARY KEY (id, sweep_id)
  );
`;

// The table predates these columns; CREATE TABLE IF NOT EXISTS leaves an existing one unchanged.
// Only additions: an older collector may be writing to the same file and must keep working.
const ADDED_COLUMNS = { list_year: 'INTEGER', radius_m: 'INTEGER', created_first: 'TEXT' };

function migrate(db: DatabaseSync) {
  const columns = db.prepare('PRAGMA table_info(listings)').all() as { name: string }[];
  for (const [name, type] of Object.entries(ADDED_COLUMNS)) {
    if (!columns.some((c) => c.name === name)) db.exec(`ALTER TABLE listings ADD COLUMN ${name} ${type}`);
  }
}

const lastComplete = `(SELECT id FROM sweeps WHERE ok = 1 ORDER BY id DESC LIMIT 1)`;

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // Another collector process may hold a brief write lock on the same file.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(schema);
  migrate(db);

  const upsert = db.prepare(`
    INSERT INTO listings (id, url, title, total, ppm, m2, rooms, floor, street, district, sector,
      private_owner, is_new_dev, from_price, posted_at, first_seen, last_sweep, list_year, radius_m, created_first)
    VALUES (:id, :url, :title, :total, :ppm, :m2, :rooms, :floor, :street, :district, :sector,
      :private_owner, :is_new_dev, :from_price, :posted_at, :first_seen, :last_sweep, :list_year, :radius_m, :created_first)
    ON CONFLICT (id) DO UPDATE SET
      url = excluded.url, title = excluded.title, total = excluded.total, ppm = excluded.ppm,
      m2 = excluded.m2, rooms = excluded.rooms, floor = excluded.floor, street = excluded.street,
      district = excluded.district, sector = excluded.sector, private_owner = excluded.private_owner,
      is_new_dev = excluded.is_new_dev, from_price = excluded.from_price, posted_at = excluded.posted_at,
      last_sweep = excluded.last_sweep, list_year = excluded.list_year, radius_m = excluded.radius_m,
      created_first = excluded.created_first,
      -- back in the search results, so worth checking again
      detail_state = CASE WHEN detail_state = 'gone' THEN NULL ELSE detail_state END
  `);
  const prior = db.prepare('SELECT total, ppm, last_sweep FROM listings WHERE id = ?');
  const keepPrice = db.prepare('INSERT OR IGNORE INTO price_history (id, sweep_id, total, ppm) VALUES (?, ?, ?, ?)');
  const recordPrice = db.prepare('INSERT OR REPLACE INTO price_history (id, sweep_id, total, ppm) VALUES (?, ?, ?, ?)');

  return {
    startSweep() {
      const result = db.prepare('INSERT INTO sweeps (started_at) VALUES (?)').run(new Date().toISOString());
      return Number(result.lastInsertRowid);
    },

    saveSearchListings(sweepId, ls) {
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        for (const l of ls) {
          const before = prior.get(l.id) as { total: number; ppm: number; last_sweep: number } | undefined;
          if (!before || before.total !== l.total) {
            // Rows saved before price_history existed have no history yet; keep the old price so the cut shows.
            if (before) keepPrice.run(l.id, before.last_sweep, before.total, before.ppm);
            recordPrice.run(l.id, sweepId, l.total, l.ppm);
          }
          upsert.run({
            id: l.id,
            url: l.url,
            title: l.title,
            total: l.total,
            ppm: l.ppm,
            m2: l.m2,
            rooms: l.rooms,
            floor: l.floor,
            street: l.street,
            district: l.district,
            sector: l.sector,
            private_owner: Number(l.privateOwner),
            is_new_dev: Number(l.isNewDev),
            from_price: Number(l.fromPrice),
            posted_at: l.postedAt,
            first_seen: now,
            last_sweep: sweepId,
            list_year: l.year ?? null,
            radius_m: l.radiusM ?? null,
            created_first: l.createdFirst ?? null,
          });
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    finishSweep(sweepId, ok) {
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE sweeps SET finished_at = ?, ok = ? WHERE id = ?').run(new Date().toISOString(), Number(ok), sweepId);
        if (ok) db.prepare('UPDATE listings SET complete_sweep = ? WHERE last_sweep = ?').run(sweepId, sweepId);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    lastCompleteSweep() {
      const row = db.prepare('SELECT id, finished_at FROM sweeps WHERE ok = 1 ORDER BY id DESC LIMIT 1').get() as
        | { id: number; finished_at: string }
        | undefined;
      return row ? { id: row.id, finishedAt: row.finished_at } : null;
    },

    // Exact for the sweep in progress and the last complete one: a listing the newer sweep rereads keeps its complete_sweep.
    listingCount(sweepId) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM listings WHERE last_sweep = ?1 OR complete_sweep = ?1').get(sweepId) as { n: number };
      return row.n;
    },

    needingDetail(limit, prioritySector) {
      const rows = db
        .prepare(
          `SELECT id, url FROM listings WHERE detail_state IS NULL AND complete_sweep = ${lastComplete}
           ORDER BY (sector IS ?) DESC, posted_at DESC LIMIT ?`,
        )
        .all(prioritySector ?? null, limit) as { id: string; url: string }[];
      return rows.map((r) => ({ id: r.id, url: r.url }));
    },

    saveDetail(id, d) {
      if (d === null) {
        db.prepare(`UPDATE listings SET detail_state = 'gone', lat = NULL, lng = NULL, precise = NULL, year = NULL, market = NULL WHERE id = ?`).run(id);
        return;
      }
      db.prepare(`UPDATE listings SET detail_state = 'saved', lat = ?, lng = ?, precise = ?, year = ?, market = ? WHERE id = ?`).run(
        d.lat,
        d.lng,
        Number(d.precise),
        d.year,
        d.market,
        id,
      );
    },

    current() {
      const rows = db
        .prepare(
          `SELECT l.*, (SELECT MAX(h.total) FROM price_history h WHERE h.id = l.id) AS peak_total FROM listings l
           WHERE complete_sweep = ${lastComplete} AND detail_state IS NOT 'gone' ORDER BY posted_at DESC`,
        )
        .all() as Row[];
      return rows.map(toStored);
    },

    close() {
      db.close();
    },
  };
}

function toStored(r: Row): StoredListing {
  const stored: StoredListing = {
    id: r.id,
    url: r.url,
    title: r.title,
    total: r.total,
    ppm: r.ppm,
    m2: r.m2,
    rooms: r.rooms,
    floor: r.floor,
    street: r.street,
    district: r.district,
    sector: r.sector,
    privateOwner: r.private_owner === 1,
    isNewDev: r.is_new_dev === 1,
    fromPrice: r.from_price === 1,
    postedAt: r.posted_at,
    firstSeen: r.first_seen,
    hasDetail: r.detail_state === 'saved',
  };
  if (r.list_year !== null) stored.year = r.list_year;
  if (r.radius_m !== null) stored.radiusM = r.radius_m;
  if (r.created_first !== null) stored.createdFirst = r.created_first;
  if (r.peak_total !== null) stored.peakTotal = r.peak_total;
  if (stored.hasDetail) {
    Object.assign(stored, { lat: r.lat, lng: r.lng, precise: r.precise === 1, year: r.year ?? r.list_year, market: r.market });
  }
  return stored;
}
