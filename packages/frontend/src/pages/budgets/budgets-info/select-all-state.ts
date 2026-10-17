import type { CheckedState } from '@/components/lib/ui/checkbox/types';

/**
 * State of a "Select all" checkbox over the rows loaded so far: checked when every
 * loaded row is picked, indeterminate when only some are, unchecked otherwise. Picks
 * outside the loaded rows (e.g. from before a filter change) don't count.
 */
export const getSelectAllState = ({
  loadedIds,
  selectedIds,
}: {
  loadedIds: string[];
  selectedIds: ReadonlySet<string>;
}): CheckedState => {
  const selectedLoaded = loadedIds.filter((id) => selectedIds.has(id)).length;
  if (selectedLoaded === 0) return false;
  return selectedLoaded === loadedIds.length ? true : 'indeterminate';
};
