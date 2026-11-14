import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseAnuntulMap } from './parseMap';

const positions = parseAnuntulMap(readFileSync('collector/fixtures/anuntul/map.html', 'utf8'));
const mapPage = (pushes: string) => `<script>
        var anunturi=[];
        ${pushes}
        var zona_user=null;
</script>`;

test('reads every pin on the map page', () => {
  expect(positions.size).toBe(1327);
});

test('a pin dropped on the map inside Bucharest is a precise position', () => {
  expect(positions.get('anuntul:66631711')).toEqual({ lat: 44.41842511874, lng: 26.198862791061, precise: true, year: null, market: null });
});

test('a geocoded pin inside Bucharest keeps its position but is not precise', () => {
  // This listing is in Rahova, yet its geocoded pin sits in Victoriei-Romana.
  expect(positions.get('anuntul:57526621')).toEqual({ lat: 44.4484754, lng: 26.0863077, precise: false, year: null, market: null });
});

test('a pin outside the Bucharest box is dropped', () => {
  expect(positions.get('anuntul:66121911')).toEqual({ lat: null, lng: null, precise: false, year: null, market: null });
});

test('a listing that is not on the map has no entry', () => {
  expect(positions.get('anuntul:1')).toBeUndefined();
});

test('an empty map is valid; a page without the pin list throws', () => {
  expect(parseAnuntulMap(mapPage('')).size).toBe(0);
  expect(parseAnuntulMap(mapPage('anunturi.push([[44.43, 26.1], 7]);')).get('anuntul:7')).toMatchObject({ lat: 44.43, precise: false });
  expect(() => parseAnuntulMap('<html><body>Verificare de securitate</body></html>')).toThrow('Anuntul map page has no listing data');
});
