
/** Pure auto-fold for the sound rack's card row (no React, no DOM). */
export interface FoldItem { id: string; width: number; instrument: boolean }
export const FOLD_GAP = 4, SPINE_W = 30;

/** Native cards and folded spines only; insertion controls live in the chain strip. */
export function rowWidth(items: FoldItem[], folded: ReadonlySet<string>): number {
  let w = 0;
  for (const it of items) w += folded.has(it.id) ? SPINE_W : it.width;
  return w + FOLD_GAP * Math.max(0, items.length - 1);
}

/**
 * Ids to fold automatically so the row fits `available`: the cards furthest from the anchor first
 * (ties: the right-hand one), the instrument last. Returns only auto-folded ids, never hand folds or the anchor.
 */
export function autoFold(items: FoldItem[], anchor: string, hand: ReadonlySet<string>, available: number): Set<string> {
  const folded = new Set(hand);
  const auto = new Set<string>();
  if (rowWidth(items, folded) <= available) return auto;
  const instId = items.find(i => i.instrument)?.id;
  const anchorId = items.some(i => i.id === anchor) ? anchor : instId;
  const anchorIndex = items.findIndex(i => i.id === anchorId);
  const order = items.map((it, index) => ({ it, index })).filter(({ it }) => !hand.has(it.id) && it.id !== anchorId);
  order.sort((a, b) => Number(a.it.instrument) - Number(b.it.instrument)
    || Math.abs(b.index - anchorIndex) - Math.abs(a.index - anchorIndex) || b.index - a.index);
  for (const { it } of order) {
    folded.add(it.id); auto.add(it.id);
    if (rowWidth(items, folded) <= available) break;
  }
  return auto;
}
