import { type DateColumnFormat, parseImportDate } from '@bt/shared/import-export/date-engine';

/**
 * Parse an import date cell into an ISO `YYYY-MM-DD` calendar day, for
 * importers that store dates rather than instants.
 *
 * `format` is resolved once for the whole column, so a d/d/yyyy file never
 * flips reading mid-import. A zoned ISO datetime reports its UTC day.
 *
 * Returns null on any unparseable input.
 */
export function parseImportDay({
  raw,
  format,
}: {
  raw: string | null | undefined;
  format: DateColumnFormat;
}): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = parseImportDate({ value: trimmed, format });
  if (!parsed) return null;

  const { year, month, day } =
    parsed.kind === 'instant'
      ? {
          year: parsed.instant.getUTCFullYear(),
          month: parsed.instant.getUTCMonth() + 1,
          day: parsed.instant.getUTCDate(),
        }
      : parsed;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
