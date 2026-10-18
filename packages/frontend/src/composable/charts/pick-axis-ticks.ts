/** Width one axis label needs, in px, before neighbours start to overlap. */
export const MIN_AXIS_LABEL_SPACING = 56;

/**
 * Evenly thinned tick values that fit `width`: every value when there's room, otherwise
 * every n-th one. The first and last are always kept so the axis shows where it starts
 * and ends.
 */
export const pickAxisTicks = <T>({
  values,
  width,
  minSpacing = MIN_AXIS_LABEL_SPACING,
}: {
  values: T[];
  width: number;
  minSpacing?: number;
}): T[] => {
  const maxTicks = Math.max(2, Math.floor(width / minSpacing));
  if (values.length <= maxTicks) return values;

  const step = Math.ceil((values.length - 1) / (maxTicks - 1));
  const picked = values.filter((_, index) => index % step === 0);
  const last = values[values.length - 1]!;
  // Drop the last regular tick when it would crowd the forced final one.
  if (picked[picked.length - 1] !== last) {
    if ((values.length - 1) % step <= step / 2) picked.pop();
    picked.push(last);
  }
  return picked;
};
