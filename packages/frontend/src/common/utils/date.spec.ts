import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatCalendarDate } from './date';

describe('formatCalendarDate', () => {
  // The day-early bug only shows west of UTC, so the test runs in Los Angeles.
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('shows the recorded day for a yyyy-MM-dd date and for a midnight-UTC timestamp', () => {
    expect(formatCalendarDate({ date: '2026-09-21', pattern: 'MMM d, yyyy' })).toBe('Sep 21, 2026');
    expect(formatCalendarDate({ date: '2026-09-21T00:00:00.000Z', pattern: 'MMM d, yyyy' })).toBe('Sep 21, 2026');
  });
});
