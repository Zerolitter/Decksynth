export interface FrameQueue {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

/** Keep only the latest input until the next frame; the owner chooses flush or discard. */
export function createFrameBatch<T>(apply: (value: T) => void, frames: FrameQueue = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
}) {
  let frame: number | null = null;
  let pending: { value: T } | null = null;
  const flush = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    const next = pending; pending = null;
    if (next) apply(next.value);
  };
  return {
    push(value: T) {
      pending = { value };
      if (frame === null) frame = frames.request(flush);
    },
    flush,
    discard() {
      if (frame !== null) frames.cancel(frame);
      frame = null; pending = null;
    },
  };
}
