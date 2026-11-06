/** One owned drag through ascending canonical values, such as musical beat divisions. */
export function createDiscreteDrag(initial: number, orderedValues: readonly number[], pixelsPerStep = 12) {
  const values = [...orderedValues];
  if (!Number.isFinite(initial)) throw new RangeError("Discrete drag requires a finite initial value.");
  if (!values.length || values.some((value, index) => !Number.isFinite(value) || index > 0 && value <= values[index - 1])) {
    throw new RangeError("Discrete drag values must be finite, unique and ascending.");
  }
  if (!Number.isFinite(pixelsPerStep) || pixelsPerStep <= 0) throw new RangeError("Discrete drag sensitivity must be positive and finite.");
  let value = initial, index = values.indexOf(initial), remainder = 0;
  return {
    /** Upward movement advances a slot. Shift scales each event, retaining partial progress. */
    move(deltaY: number, fine = false): number {
      if (!Number.isFinite(deltaY)) return value;
      const movement = -deltaY * (fine ? .1 : 1);
      remainder += movement;
      // Do not bank outward motion at an endpoint: a reversal responds immediately.
      if (index >= 0 && (index === 0 && remainder < 0 || index === values.length - 1 && remainder > 0)) {
        remainder = 0; return value;
      }
      const progress = remainder / pixelsPerStep;
      // Equivalent movement split across pointer events must cross the same threshold.
      const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(progress));
      const steps = Math.trunc(progress + Math.sign(progress) * tolerance);
      if (!steps) return value;
      if (index < 0) {
        // Keep a typed off-table value until the first threshold, then step in the intended direction.
        if (steps > 0) {
          index = values.findIndex(candidate => candidate > value);
          if (index < 0) index = values.length - 1;
        } else {
          index = values.findLastIndex(candidate => candidate < value);
          if (index < 0) index = 0;
        }
        index += steps - Math.sign(steps);
      } else index += steps;
      index = Math.max(0, Math.min(values.length - 1, index));
      value = values[index];
      remainder -= steps * pixelsPerStep;
      // Large finite deltas can overflow the division; landing at a bound still drops overshoot.
      if (!Number.isFinite(remainder) || index === 0 && remainder < 0 || index === values.length - 1 && remainder > 0) remainder = 0;
      return value;
    },
  };
}
