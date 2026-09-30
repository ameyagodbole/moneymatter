/**
 * Turns a raw tolerance input into a value the bulk scan accepts: empty or
 * non-numeric input falls back to the default, anything else is clamped to
 * the allowed range (and rounded when only whole numbers are allowed).
 */
export function normalizeTolerance({
  value,
  min,
  max,
  fallback,
  integer = false,
}: {
  value: string | number | null | undefined;
  min: number;
  max: number;
  fallback: number;
  integer?: boolean;
}): number {
  if (value === null || value === undefined || value === '') return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const rounded = integer ? Math.round(parsed) : parsed;
  return Math.min(max, Math.max(min, rounded));
}
