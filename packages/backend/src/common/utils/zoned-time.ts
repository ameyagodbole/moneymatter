export interface WallClock {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

/** True when `timezone` is an IANA zone the runtime knows. */
export function isValidTimezone({ timezone }: { timezone: string }): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/**
 * Converts wall-clock components, read as a local time in `timezone`, to the
 * absolute UTC instant. Falls back to interpreting them as UTC when `timezone`
 * is absent or invalid.
 *
 * Uses the runtime's IANA timezone database via `Intl.DateTimeFormat`, so no
 * timezone library dependency is required.
 */
export function zonedWallClockToInstant({
  wall,
  timezone,
}: {
  wall: WallClock;
  timezone: string | null | undefined;
}): Date {
  const utcGuessMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.ms);

  if (!timezone) {
    return new Date(utcGuessMs);
  }

  let offsetMs: number;
  try {
    // The offset is sampled at the guessed instant, then re-sampled at the
    // corrected instant. The second pass settles offsets that shift around a
    // DST boundary, where the first guess can land in the wrong side of the gap.
    const firstOffset = timezoneOffsetMs({ instantMs: utcGuessMs, timezone });
    offsetMs = timezoneOffsetMs({ instantMs: utcGuessMs - firstOffset, timezone });
  } catch {
    // Unknown IANA zone — treat the wall-clock components as UTC instead of throwing.
    return new Date(utcGuessMs);
  }

  return new Date(utcGuessMs - offsetMs);
}

/**
 * The calendar date and time `instant` shows on a wall clock in `timezone`.
 * Falls back to UTC when `timezone` is absent or invalid.
 */
export function instantToZonedWallClock({
  instant,
  timezone,
}: {
  instant: Date;
  timezone: string | null | undefined;
}): WallClock {
  let offsetMs = 0;
  if (timezone) {
    try {
      offsetMs = timezoneOffsetMs({ instantMs: instant.getTime(), timezone });
    } catch {
      offsetMs = 0;
    }
  }

  const shifted = new Date(instant.getTime() + offsetMs);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

/**
 * The offset (in ms) of `timezone` from UTC at the given instant — positive east
 * of UTC. Computed by formatting the instant in the zone and diffing the
 * resulting wall-clock against the same instant read as UTC. Throws if
 * `timezone` is not a valid IANA zone.
 */
function timezoneOffsetMs({ instantMs, timezone }: { instantMs: number; timezone: string }): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(instantMs));
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }

  // Some runtimes emit "24" for midnight; normalise it to "00" so Date.UTC
  // doesn't roll the day forward.
  const hour = lookup.hour === '24' ? 0 : Number(lookup.hour);
  const wallAsUtcMs = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    hour,
    Number(lookup.minute),
    Number(lookup.second),
  );

  // `instantMs` may carry sub-second precision the formatter drops; align both
  // sides to whole seconds so the offset is a clean zone offset, not noise.
  const instantWholeSecondMs = Math.floor(instantMs / 1000) * 1000;
  return wallAsUtcMs - instantWholeSecondMs;
}
