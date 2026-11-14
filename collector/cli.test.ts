import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { reason, runAnuntulDetails, runAnuntulSweep, runCollect, runDetails, runImobiliareImport, runSweep } from './cli';
import { BlockedError, HttpError } from './fetcher';
import { openStore, type Store } from './store';

const SEARCH = 'https://www.storia.ro/ro/rezultate/vanzare/apartament/bucuresti?page=';

function item(n: number) {
  return {
    id: n,
    slug: `apartament-${n}`,
    href: `[lang]/ad/apartament-${n}`,
    title: `Apartament ${n}`,
    totalPrice: { value: 100000, currency: 'EUR' },
    areaInSquareMeters: 50,
    roomsNumber: 'TWO',
    floorNumber: 'FIRST',
    isPrivateOwner: false,
    dateCreated: `2026-11-${String(n % 28 + 1).padStart(2, '0')}T10:00:00Z`,
    hidePrice: false,
    developmentId: 0,
    priceFromPerSquareMeter: null,
    investmentUnitsNumber: null,
    location: { reverseGeocoding: { locations: [{ locationLevel: 'sector', name: 'Sectorul 5' }] } },
  };
}

function nextData(data: object): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

function searchPage(ids: number[], totalPages: number): string {
  return nextData({ props: { pageProps: { data: { searchAds: { items: ids.map(item), pagination: { totalPages } } } } } });
}

const detailPage = nextData({
  props: { pageProps: { ad: { location: { coordinates: { latitude: 44.43, longitude: 26.1 }, mapDetails: { radius: 0 } }, characteristics: [] } } },
});
const expiredPage = nextData({ props: { pageProps: {} } });

// Three pages of two listings each; page n holds listings 2n-1 and 2n.
function pages(overrides: Record<number, () => string> = {}) {
  const requested: string[] = [];
  const get = async (url: string) => {
    requested.push(url);
    const page = Number(url.slice(SEARCH.length));
    if (overrides[page]) return overrides[page]();
    return searchPage([2 * page - 1, 2 * page], 3);
  };
  return { get, requested };
}

let store: Store;
let lines: string[];
const log = (line: string) => void lines.push(line);

beforeEach(() => {
  store = openStore(':memory:');
  lines = [];
});

afterEach(() => store.close());

test('runSweep reads page 1, then pages 2..totalPages, and completes the sweep', async () => {
  const { get, requested } = pages();
  await runSweep(store, get, log);

  expect(requested).toEqual([`${SEARCH}1`, `${SEARCH}2`, `${SEARCH}3`]);
  expect(store.lastCompleteSweep()).not.toBeNull();
  expect(store.current().map((l) => l.id).sort()).toEqual(['storia:1', 'storia:2', 'storia:3', 'storia:4', 'storia:5', 'storia:6']);
  expect(lines.at(-1)).toBe('Gata: 6 anunțuri citite, 0 sărite.');
});

test('runSweep blocked on page 3 fails the sweep and keeps the earlier sweep current', async () => {
  await runSweep(store, async () => searchPage([100], 1), log);
  const earlier = store.lastCompleteSweep();

  const { get } = pages({
    3: () => {
      throw new BlockedError(403);
    },
  });
  await expect(runSweep(store, get, log)).rejects.toBeInstanceOf(BlockedError);

  expect(store.lastCompleteSweep()).toEqual(earlier);
  expect(store.current().map((l) => l.id)).toEqual(['storia:100']);
  expect(lines.at(-1)).toBe('Oprit: Storia a refuzat cererea (403). Datele de ieri rămân valabile.');
});

test('runSweep fails the sweep when a page cannot be parsed', async () => {
  const { get } = pages({ 2: () => '<html>captcha</html>' });
  await expect(runSweep(store, get, log)).rejects.toThrow('Storia search page has no listing data');
  expect(store.lastCompleteSweep()).toBeNull();
});

test('runSweep logs progress every 25 pages', async () => {
  let n = 0;
  await runSweep(store, async () => searchPage([++n], 50), log);
  expect(lines).toEqual(['Pagina 25 din 50 citită.', 'Pagina 50 din 50 citită.', 'Gata: 50 anunțuri citite, 0 sărite.']);
});

async function sweepOf(ids: number[]) {
  await runSweep(store, async () => searchPage(ids, 1), () => {});
}

test('runDetails stops at the cap', async () => {
  await sweepOf([1, 2, 3, 4, 5]);
  const requested: string[] = [];
  await runDetails(store, async (url) => (requested.push(url), detailPage), log, 3);

  expect(requested).toHaveLength(3);
  expect(store.needingDetail(10)).toHaveLength(2);
  expect(lines.at(-1)).toBe('Gata: 3 anunțuri completate, 0 dispărute.');
});

test('runDetails saves null for an expired page and for a 404 or 410', async () => {
  await sweepOf([1, 2, 3, 4]);
  const answers: Record<string, () => string> = {
    'https://www.storia.ro/ro/oferta/apartament-1': () => expiredPage,
    'https://www.storia.ro/ro/oferta/apartament-2': () => {
      throw new HttpError(404);
    },
    'https://www.storia.ro/ro/oferta/apartament-3': () => {
      throw new HttpError(410);
    },
    'https://www.storia.ro/ro/oferta/apartament-4': () => detailPage,
  };
  await runDetails(store, async (url) => answers[url](), log);

  expect(store.needingDetail(10)).toEqual([]);
  expect(store.current().map((l) => l.id)).toEqual(['storia:4']);
  expect(lines.at(-1)).toBe('Gata: 1 anunțuri completate, 3 dispărute.');
});

test('runDetails on BlockedError keeps the details saved so far', async () => {
  await sweepOf([1, 2, 3]);
  let calls = 0;
  const get = async () => {
    if (++calls === 2) throw new BlockedError(429);
    return detailPage;
  };
  await expect(runDetails(store, get, log)).rejects.toBeInstanceOf(BlockedError);

  expect(store.current().filter((l) => l.hasDetail)).toHaveLength(1);
  expect(store.needingDetail(10)).toHaveLength(2);
  expect(lines.at(-1)).toBe('Oprit: Storia a refuzat cererea (429). Cele 1 anunțuri completate până acum rămân salvate.');
});

test('runDetails stops on a page without data and does not mark the listing gone', async () => {
  await sweepOf([1, 2]);
  await expect(runDetails(store, async () => '<html>captcha</html>', log)).rejects.toThrow('Storia listing page has no data');

  expect(store.needingDetail(10)).toHaveLength(2);
  expect(store.current()).toHaveLength(2);
});

test('runDetails logs progress every 100 listings with spaced thousands', async () => {
  await sweepOf(Array.from({ length: 1000 }, (_, i) => i + 1));
  await runDetails(store, async () => detailPage, log);

  expect(lines).toHaveLength(11);
  expect(lines[0]).toBe('100 din 1 000 anunțuri completate.');
  expect(lines.slice(-2)).toEqual(['1 000 din 1 000 anunțuri completate.', 'Gata: 1 000 anunțuri completate, 0 dispărute.']);
});

const ANUNTUL_LIST = 'https://www.anuntul.ro/anunturi-imobiliare-vanzari/';
const ANUNTUL_MAP = 'https://www.anuntul.ro/harta-anunturi-imobiliare-vanzari/';
const CATEGORIES = ['garsoniere', 'apartamente-2-camere', 'apartamente-3-camere', 'apartamente-4-camere'];

function anuntulCard(id: number): string {
  return `<div id="aid-${id}"  class="card impression">
    <div class="card-title h5"><a class="fw-bold" href="/anunt-vanzare-apartament-${id}-x${id}#k ">Apartament ${id}</a></div>
    <div class="card-text fs-5 fw-bold text-red-at">100.000 €</div>
    <span> Suprafata 50 mp </span>
    <span class="float-end mt-1 d-inline-block text-end"> Bucuresti, azi; 12:00 </span></div>`;
}

function anuntulList(ids: number[], totalPages: number): string {
  const links = Array.from({ length: totalPages - 1 }, (_, i) => `<a href="?page=${i + 2}">${i + 2}</a>`).join('');
  return `<html>${ids.map(anuntulCard).join('')}<ul class="pagination">${links}</ul></html>`;
}

// Category c (0..3) has two pages; page n holds listings c*10+2n-1 and c*10+2n.
function anuntulSite(overrides: Record<string, () => string> = {}) {
  const requested: string[] = [];
  const get = async (url: string) => {
    requested.push(url);
    if (overrides[url]) return overrides[url]();
    const [, slug, page] = url.slice(ANUNTUL_LIST.length).match(/^([\w-]+)\/bucuresti(?:\?page=(\d+))?$/)!;
    const c = CATEGORIES.indexOf(slug);
    const n = Number(page ?? 1);
    return anuntulList([c * 10 + 2 * n - 1, c * 10 + 2 * n], 2);
  };
  return { get, requested };
}

test('runAnuntulSweep reads every page of the four apartment categories and completes the sweep', async () => {
  const { get, requested } = anuntulSite();
  await runAnuntulSweep(store, get, log);

  expect(requested).toEqual(CATEGORIES.flatMap((c) => [`${ANUNTUL_LIST}${c}/bucuresti`, `${ANUNTUL_LIST}${c}/bucuresti?page=2`]));
  expect(store.lastCompleteSweep()).not.toBeNull();
  const current = store.current();
  expect(current).toHaveLength(16);
  expect(current.find((l) => l.id === 'anuntul:1')).toMatchObject({ rooms: 1, url: 'https://www.anuntul.ro/anunt-vanzare-apartament-1-x1' });
  expect(current.find((l) => l.id === 'anuntul:34')).toMatchObject({ rooms: 4 });
  expect(lines.at(-1)).toBe('Gata: 16 anunțuri citite, 0 sărite.');
});

test('runAnuntulSweep can stop after a number of pages per category', async () => {
  const { get, requested } = anuntulSite();
  await runAnuntulSweep(store, get, log, 1);
  expect(requested).toEqual(CATEGORIES.map((c) => `${ANUNTUL_LIST}${c}/bucuresti`));
  expect(store.current()).toHaveLength(8);
});

test('runAnuntulSweep blocked in the last category fails the sweep and keeps the earlier one current', async () => {
  await runAnuntulSweep(store, async () => anuntulList([100], 1), log);
  const earlier = store.lastCompleteSweep();

  const { get } = anuntulSite({
    [`${ANUNTUL_LIST}apartamente-4-camere/bucuresti?page=2`]: () => {
      throw new BlockedError(429);
    },
  });
  await expect(runAnuntulSweep(store, get, log)).rejects.toBeInstanceOf(BlockedError);

  expect(store.lastCompleteSweep()).toEqual(earlier);
  expect(store.current().map((l) => l.id)).toEqual(['anuntul:100']);
  expect(lines.at(-1)).toBe('Oprit: Anuntul a refuzat cererea (429). Datele de ieri rămân valabile.');
});

test('runAnuntulSweep fails the sweep on a page without cards', async () => {
  const { get } = anuntulSite({ [`${ANUNTUL_LIST}apartamente-3-camere/bucuresti`]: () => '<html>captcha</html>' });
  await expect(runAnuntulSweep(store, get, log)).rejects.toThrow('Anuntul list page has no listing data');
  expect(store.lastCompleteSweep()).toBeNull();
});

const mapPage = (pins: string[]) => `<script>var anunturi=[];${pins.join('')}var zona_user=null;</script>`;

test('runAnuntulDetails reads the four map pages and saves each listing position', async () => {
  await runAnuntulSweep(store, async () => anuntulList([1, 2, 3], 1), () => {});
  const requested: string[] = [];
  const maps: Record<string, string> = {
    [`${ANUNTUL_MAP}garsoniere/bucuresti`]: mapPage(['anunturi.push([[44.431420200185, 26.097718551698], 1]);']),
    [`${ANUNTUL_MAP}apartamente-2-camere/bucuresti`]: mapPage(['anunturi.push([[44.4484754, 26.0863077], 2]);']),
  };
  await runAnuntulDetails(store, async (url) => (requested.push(url), maps[url] ?? mapPage([])), log);

  expect(requested).toEqual(CATEGORIES.map((c) => `${ANUNTUL_MAP}${c}/bucuresti`));
  expect(store.needingDetail(10)).toEqual([]);
  const byId = new Map(store.current().map((l) => [l.id, l]));
  expect(byId.get('anuntul:1')).toMatchObject({ hasDetail: true, lat: 44.431420200185, precise: true });
  expect(byId.get('anuntul:2')).toMatchObject({ hasDetail: true, lat: 44.4484754, precise: false });
  expect(byId.get('anuntul:3')).toMatchObject({ hasDetail: true, lat: null, lng: null, precise: false });
  expect(lines.at(-1)).toBe('Gata: 2 anunțuri cu poziție, 1 fără poziție.');
});

test('runAnuntulDetails stops at the cap', async () => {
  await runAnuntulSweep(store, async () => anuntulList([1, 2, 3], 1), () => {});
  await runAnuntulDetails(store, async () => mapPage([]), log, 2);
  expect(store.needingDetail(10)).toHaveLength(1);
});

test('runAnuntulDetails blocked on a map page saves nothing', async () => {
  await runAnuntulSweep(store, async () => anuntulList([1, 2], 1), () => {});
  let calls = 0;
  const get = async () => {
    if (++calls === 3) throw new BlockedError(403);
    return mapPage([]);
  };
  await expect(runAnuntulDetails(store, get, log)).rejects.toBeInstanceOf(BlockedError);
  expect(store.needingDetail(10)).toHaveLength(2);
  expect(lines.at(-1)).toBe('Oprit: Anuntul a refuzat cererea (403). Nicio poziție nu a fost salvată.');
});

test('runAnuntulDetails stops on a map page without pins', async () => {
  await runAnuntulSweep(store, async () => anuntulList([1], 1), () => {});
  await expect(runAnuntulDetails(store, async () => '<html>captcha</html>', log)).rejects.toThrow('Anuntul map page has no listing data');
  expect(store.needingDetail(10)).toHaveLength(1);
});

function pagesDir(): string {
  const dir = mkdtempSync(`${tmpdir()}/imobiliare-`);
  copyFileSync('collector/fixtures/imobiliare/list.html', `${dir}/a.html`);
  copyFileSync('collector/fixtures/imobiliare/list.html', `${dir}/b.html`);
  return dir;
}

test('runImobiliareImport reads every saved page, counts an apartment once and completes the sweep', async () => {
  const log: string[] = [];
  const dir = pagesDir();
  await runImobiliareImport(store, (l) => log.push(l), dir);
  expect(log.at(-1)).toBe('Gata: 2 fișiere, 3 apartamente citite, 0 cu poziție (paginile de rezultate nu au coordonate).');
  expect(store.lastCompleteSweep()).not.toBeNull();
});

test('runImobiliareImport fails loudly on a page it cannot read and keeps the earlier sweep', async () => {
  const dir = pagesDir();
  await runImobiliareImport(store, () => {}, dir);
  const before = store.lastCompleteSweep();
  writeFileSync(`${dir}/c.html`, '<html>Acces refuzat</html>');
  const log: string[] = [];
  await expect(runImobiliareImport(store, (l) => log.push(l), dir)).rejects.toThrow('c.html');
  expect(log.at(-1)).toContain('c.html');
  expect(store.lastCompleteSweep()).toEqual(before);
});

test('runImobiliareImport says what to do when the folder is empty', async () => {
  const dir = mkdtempSync(`${tmpdir()}/imobiliare-`);
  const log: string[] = [];
  await expect(runImobiliareImport(store, (l) => log.push(l), dir)).rejects.toThrow();
  expect(log[0]).toContain('Cmd+S');
});

const NETWORK = 'nu există conexiune la internet sau site-ul nu răspunde';
const FORMAT = 'pagina site-ului arată altfel decât ne așteptam (probabil și-a schimbat formatul)';

test('reason explains common failures in plain Romanian', () => {
  expect(reason(new TypeError('fetch failed'))).toBe(NETWORK);
  expect(reason(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(NETWORK);
  expect(reason(new BlockedError(403))).toBe('Storia a refuzat cererea (403)');
  expect(reason(new BlockedError(429), 'Anuntul')).toBe('Anuntul a refuzat cererea (429)');
  for (const message of [
    'Storia search page has no listing data',
    'Storia search page has no page count',
    'Storia search page has no recognisable listing links',
    'Storia listing page has no data',
    'Anuntul list page has no listing data',
    'Anuntul list page has no page count',
    'Anuntul map page has no listing data',
  ]) {
    expect(reason(new Error(message))).toBe(FORMAT);
  }
  expect(reason(new Error('Nu există nicio colectare completă'))).toBe('Nu există nicio colectare completă');
});

function fakeSteps(failing: string[] = []) {
  const ran: string[] = [];
  const step = (name: string) => async (log: (line: string) => void) => {
    ran.push(name);
    if (failing.includes(name)) {
      log(`Oprit: ${name}.`);
      throw new Error(name);
    }
  };
  const steps = {
    sweep: step('sweep'),
    details: step('details'),
    anuntulSweep: step('anuntulSweep'),
    anuntulDetails: step('anuntulDetails'),
    export: step('export'),
  };
  return { steps, ran };
}

test('runCollect runs all five steps in order and reports success', async () => {
  const { steps, ran } = fakeSteps();
  expect(await runCollect(steps, log)).toBe(true);
  expect(ran).toEqual(['sweep', 'details', 'anuntulSweep', 'anuntulDetails', 'export']);
});

test('runCollect stops after a failed Storia sweep so the last good export stays', async () => {
  const { steps, ran } = fakeSteps(['sweep']);
  expect(await runCollect(steps, log)).toBe(false);
  expect(ran).toEqual(['sweep']);
});

test('runCollect still reads Anuntul and exports when Storia details fail, and reports failure', async () => {
  const { steps, ran } = fakeSteps(['details']);
  expect(await runCollect(steps, log)).toBe(false);
  expect(ran).toEqual(['sweep', 'details', 'anuntulSweep', 'anuntulDetails', 'export']);
});

test('runCollect skips Anuntul positions after a failed Anuntul sweep but still exports', async () => {
  const { steps, ran } = fakeSteps(['anuntulSweep']);
  expect(await runCollect(steps, log)).toBe(false);
  expect(ran).toEqual(['sweep', 'details', 'anuntulSweep', 'export']);
});

test('runCollect reports a failed export', async () => {
  const { steps } = fakeSteps(['export']);
  expect(await runCollect(steps, log)).toBe(false);
});

test('a step that fails without saying why gets an Oprit line; one that already said why does not repeat it', async () => {
  const { steps } = fakeSteps(['details']);
  await runCollect({ ...steps, anuntulDetails: async () => { throw new TypeError('fetch failed'); } }, log);
  expect(lines.filter((l) => l.startsWith('Oprit:'))).toEqual(['Oprit: details.', `Oprit: ${NETWORK}.`]);
});
