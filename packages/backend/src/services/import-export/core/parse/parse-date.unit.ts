import { describe, expect, it } from '@jest/globals';

import { parseImportDay } from './parse-date';

describe('parseImportDay', () => {
  it('returns the calendar day under the column format', () => {
    expect(parseImportDay({ raw: ' 05/03/2026 ', format: { fieldOrder: 'day-first' } })).toBe('2026-03-05');
    expect(parseImportDay({ raw: 'Sep 21, 2026', format: { fieldOrder: 'day-first' } })).toBe('2026-09-21');
    expect(parseImportDay({ raw: '21.Sep.2026', format: { fieldOrder: 'day-first', pattern: 'd.MMM.yyyy' } })).toBe(
      '2026-09-21',
    );
  });

  it('reports the UTC day of a zoned ISO datetime', () => {
    expect(parseImportDay({ raw: '2026-09-21T23:30:00-03:00', format: { fieldOrder: 'day-first' } })).toBe(
      '2026-09-22',
    );
  });

  it('returns null for missing, blank or unparseable cells', () => {
    const format = { fieldOrder: 'month-first' } as const;
    expect(parseImportDay({ raw: null, format })).toBeNull();
    expect(parseImportDay({ raw: '  ', format })).toBeNull();
    expect(parseImportDay({ raw: '13/13/2026', format })).toBeNull();
  });
});
