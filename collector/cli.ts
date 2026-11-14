import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Detail } from '../shared/types';
import { parseAnuntulList } from './anuntul/parseList';
import { parseAnuntulMap } from './anuntul/parseMap';
import { parseImobiliareList } from './imobiliare/parseList';
import { BlockedError, HttpError, createFetcher } from './fetcher';
import { runExport } from './export';
import { loadBoundaries, loadParks, loadStations, runOsm } from './osm';
import { openStore, type Store } from './store';
import { parseDetailPage } from './storia/parseDetail';
import { parseSearchPage } from './storia/parseSearch';

type Get = (url: string) => Promise<string>;
type Log = (line: string) => void;

const SEARCH_URL = 'https://www.storia.ro/ro/rezultate/vanzare/apartament/bucuresti?page=';
const DELAY_MS = 1200;
const PAGE_SIZE = 36;
// A run that ends without an error can still have been cut short (an empty page, a quiet block); it must not replace a full one.
const MIN_SHARE_OF_PREVIOUS = 0.7;
const MIN_SHARE_OF_PAGES = 0.5;
// A complete sweep today reads about 94% of pages x page size (the last page is partial, development posts are skipped).
const FULL_PAGES_SHARE = 0.85;
// A lock file with no pid yet is being written by the process that just created it; only an old one is abandoned.
const LOCK_WRITE_GRACE_MS = 10_000;
// No collection runs this long; an older lock is left over, even if its pid now belongs to some other process.
const LOCK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LOCK_PATH = fileURLToPath(new URL('../data/collect.lock', import.meta.url));
const STORE_PATH = fileURLToPath(new URL('../data/prices.sqlite', import.meta.url));
// Its own file, so collecting Anuntul never touches the Storia database.
const ANUNTUL_STORE_PATH = fileURLToPath(new URL('../data/anuntul.sqlite', import.meta.url));
// Imobiliare.ro is never fetched: the pages are saved by hand into this folder and only read from here.
const IMOBILIARE_STORE_PATH = fileURLToPath(new URL('../data/imobiliare.sqlite', import.meta.url));
const IMOBILIARE_PAGES = fileURLToPath(new URL('../data/imobiliare-pages', import.meta.url));
const ANUNTUL_CATEGORIES = [
  { slug: 'garsoniere', rooms: 1 },
  { slug: 'apartamente-2-camere', rooms: 2 },
  { slug: 'apartamente-3-camere', rooms: 3 },
  { slug: 'apartamente-4-camere', rooms: 4 },
];
const NO_POSITION: Detail = { lat: null, lng: null, precise: false, year: null, market: null };

// A sweep is rejected when it is short against its own page count (pages went missing), or when it is far below the
// last complete one and also not filling the pages it reports: a market that really shrank fills fewer, full pages and
// passes, so a real drop cannot block collection for good.
export function shortfall(read: number, totalPages: number, previous: number | null): string | null {
  const fillsPages = read >= FULL_PAGES_SHARE * totalPages * PAGE_SIZE;
  if (previous !== null && read < MIN_SHARE_OF_PREVIOUS * previous && !fillsPages) {
    return `doar ${amount(read, 'anunț', 'anunțuri')}, față de ${count(previous)} la colectarea anterioară`;
  }
  if (read < MIN_SHARE_OF_PAGES * totalPages * PAGE_SIZE) return `doar ${amount(read, 'anunț', 'anunțuri')} pe ${amount(totalPages, 'pagină', 'pagini')}`;
  return null;
}

// Romanian puts "de" between a number and its noun from 20 on, except when the last two digits are 01–19.
function amount(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return rest === 0 || rest >= 20 ? `${count(n)} de ${many}` : `${count(n)} ${many}`;
}

export async function runSweep(store: Store, get: Get, log: Log): Promise<void> {
  const previous = store.lastCompleteSweep();
  const previousCount = previous ? store.listingCount(previous.id) : null;
  const sweepId = store.startSweep();
  let read = 0;
  let skipped = 0;
  const readPage = async (n: number) => {
    const page = parseSearchPage(await get(SEARCH_URL + n));
    store.saveSearchListings(sweepId, page.listings);
    read += page.listings.length;
    skipped += page.skipped;
    return page;
  };

  try {
    const { totalPages } = await readPage(1);
    for (let n = 2; n <= totalPages; n++) {
      await readPage(n);
      if (n % 25 === 0) log(`Pagina ${n} din ${totalPages} citită.`);
    }
    const short = shortfall(store.listingCount(sweepId), totalPages, previousCount);
    if (short) throw new Error(`colectarea a citit prea puține anunțuri (${short}), așa că nu o folosim`);
    store.finishSweep(sweepId, true);
  } catch (e) {
    store.finishSweep(sweepId, false);
    log(`Oprit: ${reason(e)}. Datele de ieri rămân valabile.`);
    throw e;
  }
  log(`Gata: ${count(read)} anunțuri citite, ${count(skipped)} sărite.`);
}

export async function runDetails(store: Store, get: Get, log: Log, cap = 4000): Promise<void> {
  // The owner is hunting in Sector 1, so its positions are fetched before the rest of the city.
  const todo = store.needingDetail(cap, 'Sectorul 1');
  let saved = 0;
  let gone = 0;

  for (const [i, { id, url }] of todo.entries()) {
    let detail: Detail | null;
    try {
      detail = parseDetailPage(await get(url));
    } catch (e) {
      const listingGone = e instanceof HttpError && (e.status === 404 || e.status === 410);
      if (!listingGone) {
        log(`Oprit: ${reason(e)}. Cele ${count(saved)} anunțuri completate până acum rămân salvate.`);
        throw e;
      }
      detail = null;
    }
    store.saveDetail(id, detail);
    if (detail) saved++;
    else gone++;
    if ((i + 1) % 100 === 0) log(`${count(i + 1)} din ${count(todo.length)} anunțuri completate.`);
  }
  log(`Gata: ${count(saved)} anunțuri completate, ${count(gone)} dispărute.`);
}

export async function runAnuntulSweep(store: Store, get: Get, log: Log, maxPages = Infinity): Promise<void> {
  const sweepId = store.startSweep();
  let read = 0;
  let skipped = 0;
  try {
    for (const { slug, rooms } of ANUNTUL_CATEGORIES) {
      const listUrl = `https://www.anuntul.ro/anunturi-imobiliare-vanzari/${slug}/bucuresti`;
      for (let n = 1, totalPages = 1; n <= Math.min(totalPages, maxPages); n++) {
        const page = parseAnuntulList(await get(n === 1 ? listUrl : `${listUrl}?page=${n}`), rooms);
        store.saveSearchListings(sweepId, page.listings);
        read += page.listings.length;
        skipped += page.skipped;
        totalPages = page.totalPages;
      }
    }
    store.finishSweep(sweepId, true);
  } catch (e) {
    store.finishSweep(sweepId, false);
    log(`Oprit: ${reason(e, 'Anuntul')}. Datele de ieri rămân valabile.`);
    throw e;
  }
  log(`Gata: ${count(read)} anunțuri citite, ${count(skipped)} sărite.`);
}

// Every pin of a category sits on one map page, so four requests place all listings.
export async function runAnuntulDetails(store: Store, get: Get, log: Log, cap = 4000): Promise<void> {
  const todo = store.needingDetail(cap);
  const positions = new Map<string, Detail>();
  try {
    for (const { slug } of ANUNTUL_CATEGORIES) {
      for (const [id, d] of parseAnuntulMap(await get(`https://www.anuntul.ro/harta-anunturi-imobiliare-vanzari/${slug}/bucuresti`))) {
        positions.set(id, d);
      }
    }
  } catch (e) {
    log(`Oprit: ${reason(e, 'Anuntul')}. Nicio poziție nu a fost salvată.`);
    throw e;
  }

  let placed = 0;
  for (const { id } of todo) {
    const detail = positions.get(id) ?? NO_POSITION;
    store.saveDetail(id, detail);
    if (detail.lat !== null) placed++;
  }
  log(`Gata: ${count(placed)} anunțuri cu poziție, ${count(todo.length - placed)} fără poziție.`);
}

export async function runImobiliareImport(store: Store, log: Log, dir = IMOBILIARE_PAGES): Promise<void> {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')).sort() : [];
  if (files.length === 0) {
    log(`Oprit: niciun fișier .html în ${dir}. Salvează paginile de rezultate din browser (Cmd+S).`);
    throw new Error('no saved pages');
  }
  const sweepId = store.startSweep();
  const seen = new Set<string>();
  try {
    for (const file of files) {
      let page;
      try {
        page = parseImobiliareList(readFileSync(`${dir}/${file}`, 'utf8'));
      } catch (e) {
        throw new Error(`${file}: ${e instanceof Error ? e.message : e}`);
      }
      // The same apartment can sit on two saved pages; count and keep it once.
      const fresh = page.listings.filter((l) => !seen.has(l.id));
      fresh.forEach((l) => seen.add(l.id));
      store.saveSearchListings(sweepId, fresh);
    }
    store.finishSweep(sweepId, true);
  } catch (e) {
    store.finishSweep(sweepId, false);
    log(`Oprit: ${reason(e, 'Imobiliare')}. Datele anterioare rămân valabile.`);
    throw e;
  }
  for (const { id } of store.needingDetail(1_000_000)) store.saveDetail(id, NO_POSITION);
  log(`Gata: ${count(files.length)} fișiere, ${count(seen.size)} apartamente citite, 0 cu poziție (paginile de rezultate nu au coordonate).`);
}

export function reason(e: unknown, site = 'Storia'): string {
  if (e instanceof BlockedError) return `${site} a refuzat cererea (${e.status})`;
  if (e instanceof HttpError) return `${site} a răspuns ${e.status}`;
  if (!(e instanceof Error)) return String(e);
  // fetch reports a lost connection as a TypeError; AbortSignal.timeout as a TimeoutError.
  if (e instanceof TypeError || e.name === 'TimeoutError') return 'nu există conexiune la internet sau site-ul nu răspunde';
  if (/has no (listing )?data|no recognisable listing links|no page count/.test(e.message)) {
    return 'pagina site-ului arată altfel decât ne așteptam (probabil și-a schimbat formatul)';
  }
  return e.message;
}

function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+$)/g, ' ');
}

const commands: Record<string, (store: Store, get: Get, log: Log) => Promise<void>> = {
  sweep: runSweep,
  details: (store, get, log) => runDetails(store, get, log),
  osm: (_store, _get, log) => runOsm(log),
  export: async (store, _get, log) => {
    const anuntul = existsSync(ANUNTUL_STORE_PATH) ? openStore(ANUNTUL_STORE_PATH) : undefined;
    const imobiliare = existsSync(IMOBILIARE_STORE_PATH) ? openStore(IMOBILIARE_STORE_PATH) : undefined;
    try {
      runExport(store, loadStations(), loadParks(), loadBoundaries(), 'web/public/data', log, anuntul, imobiliare);
    } catch (e) {
      log(`Oprit: ${reason(e)}.`);
      throw e;
    } finally {
      anuntul?.close();
      imobiliare?.close();
    }
  },
  'imobiliare-import': (store, _get, log) => runImobiliareImport(store, log, process.argv[3]),
  'anuntul-sweep': runAnuntulSweep,
  'anuntul-details': (store, get, log) => runAnuntulDetails(store, get, log),
};

// A lock left by a process that no longer runs (a crash, a closed laptop lid) must not block the next collection.
export function staleLock(contents: string, alive: (pid: number) => boolean, ageMs = 0): boolean {
  if (ageMs > LOCK_MAX_AGE_MS) return true;
  const text = contents.trim();
  // Empty: created but not written yet, so held, unless it has sat empty for longer than any write takes.
  if (text === '') return ageMs > LOCK_WRITE_GRACE_MS;
  const pid = Number(text);
  return !Number.isInteger(pid) || pid <= 0 || !alive(pid);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to another user.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// Returns a release function, or the pid of the collection already running.
export function takeLock(path: string, alive = running): (() => void) | number {
  mkdirSync(dirname(path), { recursive: true });
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      let held = true;
      return () => {
        if (held) rmSync(path, { force: true });
        held = false;
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let holder: string;
    let age: number;
    try {
      holder = readFileSync(path, 'utf8');
      age = Date.now() - statSync(path).mtimeMs;
    } catch {
      continue; // released between the two calls
    }
    if (!staleLock(holder, alive, age)) return Number(holder.trim()) || 0;
    // Another process may have taken the stale lock over a moment ago: remove only the lock judged stale.
    try {
      if (readFileSync(path, 'utf8') !== holder) continue;
    } catch {
      continue;
    }
    rmSync(path, { force: true });
  }
}

type Step = (log: Log) => Promise<void>;

// Runs a step and makes sure a failure is explained once, whether or not the step already said why it stopped.
async function attempt(step: Step, log: Log): Promise<boolean> {
  let explained = false;
  try {
    await step((line) => {
      if (line.startsWith('Oprit:')) explained = true;
      log(line);
    });
    return true;
  } catch (e) {
    if (!explained) log(`Oprit: ${reason(e)}.`);
    return false;
  }
}

// A failed Storia sweep stops everything so the last good export stays; after that every step runs and the export always happens.
export async function runCollect(
  steps: { sweep: Step; details: Step; anuntulSweep: Step; anuntulDetails: Step; export: Step },
  log: Log,
): Promise<boolean> {
  log('Storia, lista de anunțuri:');
  if (!(await attempt(steps.sweep, log))) return false;
  log('Storia, detaliile anunțurilor:');
  let ok = await attempt(steps.details, log);
  log('Anuntul, lista de anunțuri:');
  if (await attempt(steps.anuntulSweep, log)) {
    log('Anuntul, pozițiile anunțurilor:');
    ok = (await attempt(steps.anuntulDetails, log)) && ok;
  } else {
    ok = false;
  }
  log('Export pentru site:');
  ok = (await attempt(steps.export, log)) && ok;
  if (!ok) log('Colectarea s-a încheiat, dar unii pași nu au reușit (vezi rândurile „Oprit” de mai sus).');
  return ok;
}

async function main(command: string | undefined): Promise<void> {
  if (!command || (command !== 'collect' && !(command in commands))) {
    console.log(`Comenzi disponibile: collect, ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  let release = () => {};
  if (command !== 'export' && command !== 'osm') {
    const lock = takeLock(LOCK_PATH);
    if (typeof lock === 'number') {
      console.log(`Oprit: o altă colectare rulează deja${lock > 0 ? ` (procesul ${lock})` : ''}. Așteaptă să se termine, apoi încearcă din nou.`);
      process.exitCode = 1;
      return;
    }
    release = lock;
    process.once('exit', release);
    // Ctrl+C and a kill do not run 'exit' handlers by themselves: release the lock, then stop as the signal asked.
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        release();
        // The usual exit codes for a process stopped by these signals.
        process.exit(signal === 'SIGINT' ? 130 : 143);
      });
    }
  }
  try {
    await runCommand(command);
  } finally {
    release();
  }
}

async function runCommand(command: string): Promise<void> {
  const get = createFetcher({ delayMs: DELAY_MS });
  const run = (name: string): Step => async (log) => {
    const store = openStore(name.startsWith('anuntul-') ? ANUNTUL_STORE_PATH : name.startsWith('imobiliare-') ? IMOBILIARE_STORE_PATH : STORE_PATH);
    try {
      await commands[name](store, get, log);
    } finally {
      store.close();
    }
  };
  const ok =
    command === 'collect'
      ? await runCollect(
          { sweep: run('sweep'), details: run('details'), anuntulSweep: run('anuntul-sweep'), anuntulDetails: run('anuntul-details'), export: run('export') },
          console.log,
        )
      : await attempt(run(command), console.log);
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2]);
}
