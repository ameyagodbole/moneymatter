import { describe, expect, it } from 'vitest';

import { getLimitLeft, getNetSpend } from './budget-limit-left';

describe('getNetSpend', () => {
  it('subtracts income from expenses', () => {
    expect(getNetSpend({ expense: 3460.98, income: 0 })).toBe(3460.98);
    expect(getNetSpend({ expense: 100, income: 150 })).toBe(-50);
  });
});

describe('getLimitLeft', () => {
  it('is what the net spend leaves of the limit', () => {
    expect(getLimitLeft({ limit: 6000, netSpend: 3460 })).toBe(2540);
  });

  it('goes negative once the limit is exceeded', () => {
    expect(getLimitLeft({ limit: 500, netSpend: 620 })).toBe(-120);
  });

  it('never grows past the limit from net income', () => {
    expect(getLimitLeft({ limit: 500, netSpend: -50 })).toBe(500);
  });

  it('is null without a limit', () => {
    expect(getLimitLeft({ limit: null, netSpend: 100 })).toBeNull();
    expect(getLimitLeft({ limit: undefined, netSpend: 100 })).toBeNull();
  });
});
