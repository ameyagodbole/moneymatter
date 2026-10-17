import { describe, expect, it } from 'vitest';

import { getSelectAllState } from './select-all-state';

describe('getSelectAllState', () => {
  const loadedIds = ['a', 'b', 'c'];

  it('is unchecked when nothing loaded is picked', () => {
    expect(getSelectAllState({ loadedIds, selectedIds: new Set() })).toBe(false);
    expect(getSelectAllState({ loadedIds: [], selectedIds: new Set() })).toBe(false);
  });

  it('is indeterminate when some loaded rows are picked', () => {
    expect(getSelectAllState({ loadedIds, selectedIds: new Set(['a']) })).toBe('indeterminate');
  });

  it('is checked when every loaded row is picked', () => {
    expect(getSelectAllState({ loadedIds, selectedIds: new Set(['a', 'b', 'c']) })).toBe(true);
  });

  it('ignores picks outside the loaded rows', () => {
    expect(getSelectAllState({ loadedIds, selectedIds: new Set(['x', 'y']) })).toBe(false);
    expect(getSelectAllState({ loadedIds, selectedIds: new Set(['a', 'b', 'c', 'x']) })).toBe(true);
  });
});
