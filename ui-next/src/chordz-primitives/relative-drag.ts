export interface RelativeMovement { dx: number; dy: number; fine: boolean }
export interface RelativeDragHandle { cancel(): void }
export interface RelativeDragOptions {
  /** Distance before a click becomes a drag. Zero starts on pointerdown. */
  threshold?: number;
  /** Numeric text fields can retain horizontal selection while vertical movement starts scrubbing. */
  thresholdAxis?: "x" | "y" | "both";
  /** Mouse Pointer Lock is opportunistic; capture remains the fallback. */
  pointerLock?: boolean;
  /** Movement from the press before Pointer Lock is requested, so clicks and double-clicks never lock or hide the cursor. */
  lockThreshold?: number;
  onStart(): boolean;
  onMove(movement: RelativeMovement): void;
  onEnd(canceled: boolean): void;
}

type DragOwner = RelativeDragHandle & { element: HTMLElement | SVGElement; acceptsLock(): boolean };
const owners = new WeakMap<Document, DragOwner>();
const pendingRequests = new WeakMap<Document, object>();
const capture = { capture: true };
/** Same distance the numeric readouts use before a press becomes a scrub. */
export const LOCK_THRESHOLD = 4;
/**
 * Chromium sometimes reports one bogus movementX/Y right after Pointer Lock engages (and when the
 * hidden cursor is re-centred, notably on Windows): hundreds of pixels in a single event. Real hand
 * movement arrives coalesced per frame and stays far below these limits even on a fast flick.
 */
export const LOCK_SPIKE_PX = 200;
const FIRST_LOCKED_MAX_PX = 50;
/** A request that never reports back must not disable Pointer Lock for the rest of the session. */
const STALE_REQUEST_MS = 1000;

/** One document owns one relative drag. Call cancel when the control loses its edit ownership or lifetime. */
export function startRelativeDrag(element: HTMLElement | SVGElement, event: PointerEvent, options: RelativeDragOptions): RelativeDragHandle | null {
  const document = element.ownerDocument, window = document.defaultView;
  if (!window || event.button !== 0 || event.isPrimary === false) return null;
  const inputWindow = window;
  if (document.pointerLockElement && owners.get(document)?.element !== document.pointerLockElement) return null;
  // An older request can still grant after cancellation. This drag stays in capture until its next gesture.
  const mayRequestLock = !pendingRequests.has(document), requestToken = {};
  owners.get(document)?.cancel();
  const grabFine = event.shiftKey || event.ctrlKey;
  const mouse = event.pointerType === "mouse" || !event.pointerType, id = event.pointerId;
  const threshold = Math.max(0, options.threshold ?? 0), originX = event.clientX, originY = event.clientY;
  const lockThreshold = Math.max(threshold, options.lockThreshold ?? LOCK_THRESHOLD);
  let x = originX, y = originY, started = false, ended = false, locked = false, pendingLock = false, lockArmed = false, lockedPointerMoves = false, lockedEvents = 0;
  let cursorStyle: HTMLStyleElement | null = null, lockListeners = false;
  const handle: DragOwner = { element, cancel: () => finish(true), acceptsLock: () => !ended && (pendingLock || locked) };

  function releaseCapture() {
    try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* The pointer may already have ended. */ }
  }
  function removeLockListeners() {
    if (!lockListeners) return;
    lockListeners = false;
    document.removeEventListener("pointerlockchange", lockChange);
    document.removeEventListener("pointerlockerror", lockError);
  }
  function releaseLateLock() {
    const owner = owners.get(document);
    // A timed-out observer may see a newer request for the same element grant.
    // Capture-only successors have neither a pending request nor an accepted lock.
    if (document.pointerLockElement === element && !(owner?.element === element && owner.acceptsLock())) document.exitPointerLock();
  }
  function hideCursor() {
    if (cursorStyle) return;
    cursorStyle = document.createElement("style");
    cursorStyle.textContent = "html, html * { cursor: none !important; }";
    document.head.appendChild(cursorStyle);
  }
  function settleRequest() {
    pendingLock = false;
    if (pendingRequests.get(document) === requestToken) pendingRequests.delete(document);
  }
  function lockChange() {
    if (document.pointerLockElement === element) {
      settleRequest();
      if (ended) { releaseLateLock(); removeLockListeners(); return; }
      locked = true;
      // Only a granted lock hides the cursor; a capture-only drag keeps it visible.
      hideCursor();
      // Browsers release capture when locking. That deliberate handoff is not cancellation.
      releaseCapture();
    } else if (locked || !ended && document.pointerLockElement) {
      finish(true);
    } else if (ended && !pendingLock) removeLockListeners();
  }
  function lockError() {
    settleRequest();
    if (ended) removeLockListeners();
  }
  function requestLock() {
    if (!mouse || !mayRequestLock || options.pointerLock === false || !element.requestPointerLock) return;
    pendingLock = true; lockListeners = true; pendingRequests.set(document, requestToken);
    document.addEventListener("pointerlockchange", lockChange);
    document.addEventListener("pointerlockerror", lockError);
    try {
      const request = element.requestPointerLock();
      // Older implementations return void and report their result only through document events.
      if (request && typeof request.then === "function") request.then(() => {
        if (!pendingLock) return;
        settleRequest();
        if (ended) { releaseLateLock(); removeLockListeners(); }
        else lockChange();
      }, lockError);
    } catch { lockError(); }
  }
  function begin(moveEvent: Event) {
    if (started) return true;
    if (ended || !options.onStart() || ended) { finish(true); return false; }
    started = true;
    moveEvent.preventDefault();
    return !ended;
  }
  function armLock(distance: number) {
    if (lockArmed || distance < lockThreshold) return;
    lockArmed = true; requestLock();
  }
  function publish(dx: number, dy: number, moveEvent: MouseEvent) {
    if (!ended && started && (dx || dy)) options.onMove({ dx, dy, fine: grabFine || moveEvent.shiftKey || moveEvent.ctrlKey });
  }
  /**
   * Granting Pointer Lock moves the hidden cursor to the window centre, and Chromium can report that
   * as an ordinary move before the lock is reported. While a request is pending, a jump that large is
   * the warp, not the hand; any capture move beyond the spike limit is treated the same way.
   */
  function warp(dx: number, dy: number) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return size > LOCK_SPIKE_PX || (pendingLock && size > FIRST_LOCKED_MAX_PX);
  }
  function lockedMove(event: MouseEvent) {
    event.preventDefault();
    const dx = event.movementX, dy = event.movementY, size = Math.max(Math.abs(dx), Math.abs(dy));
    const spike = size > LOCK_SPIKE_PX || (lockedEvents === 0 && size > FIRST_LOCKED_MAX_PX);
    lockedEvents++;
    if (!spike) publish(dx, dy, event);
    if (event.buttons === 0) finish(false);
  }
  function move(event: PointerEvent) {
    if (ended || event.pointerId !== id) return;
    // Locked pointers report relative movement on pointermove; the compatibility mousemove is then ignored.
    if (locked) { lockedPointerMoves = true; lockedMove(event); return; }
    if (document.pointerLockElement === element) return;
    const distance = options.thresholdAxis === "x" ? Math.abs(event.clientX - originX)
      : options.thresholdAxis === "y" ? Math.abs(event.clientY - originY) : Math.hypot(event.clientX - originX, event.clientY - originY);
    if (!started && distance < threshold) return;
    if (!begin(event)) return;
    const dx = event.clientX - x, dy = event.clientY - y;
    x = event.clientX; y = event.clientY;
    event.preventDefault();
    if (!warp(dx, dy)) publish(dx, dy, event);
    if (mouse && event.buttons === 0) { finish(false); return; }
    armLock(distance);
  }
  function mouseMove(event: MouseEvent) {
    if (!ended && locked && !lockedPointerMoves) lockedMove(event);
  }
  function up(event: PointerEvent) {
    if (ended || event.pointerId !== id) return;
    if (started && !locked) move(event);
    finish(false);
  }
  function mouseUp(event: MouseEvent) {
    if (ended || !mouse || event.button !== 0) return;
    if (started && !locked) {
      const dx = event.clientX - x, dy = event.clientY - y;
      x = event.clientX; y = event.clientY;
      if (!warp(dx, dy)) publish(dx, dy, event);
    }
    finish(false);
  }
  function pointerCancel(event: PointerEvent) { if (event.pointerId === id) finish(true); }
  function lostCapture(event: Event) { if ((event as PointerEvent).pointerId === id && !locked && document.pointerLockElement !== element) finish(true); }
  function keyDown(event: KeyboardEvent) { if (event.key === "Escape") { if (started) { event.preventDefault(); event.stopPropagation(); } finish(true); } }
  function blur() { finish(true); }
  function visibility() { if (document.hidden) finish(true); }
  function finish(canceled: boolean) {
    if (ended) return;
    ended = true;
    if (owners.get(document) === handle) owners.delete(document);
    document.removeEventListener("pointermove", move, capture);
    document.removeEventListener("pointerup", up, capture);
    document.removeEventListener("pointercancel", pointerCancel, capture);
    document.removeEventListener("mousemove", mouseMove, capture);
    document.removeEventListener("mouseup", mouseUp, capture);
    document.removeEventListener("keydown", keyDown, capture);
    document.removeEventListener("visibilitychange", visibility);
    inputWindow.removeEventListener("blur", blur);
    element.removeEventListener("lostpointercapture", lostCapture);
    releaseCapture(); cursorStyle?.remove(); cursorStyle = null;
    if (document.pointerLockElement === element) { settleRequest(); removeLockListeners(); document.exitPointerLock(); }
    // Keep only lock-result observers while a request is pending so a late grant is released.
    if (!pendingLock) removeLockListeners();
    else setTimeout(() => { if (pendingRequests.get(document) === requestToken) pendingRequests.delete(document); }, STALE_REQUEST_MS);
    if (started) options.onEnd(canceled);
  }

  owners.set(document, handle);
  document.addEventListener("pointermove", move, capture);
  document.addEventListener("pointerup", up, capture);
  document.addEventListener("pointercancel", pointerCancel, capture);
  document.addEventListener("mousemove", mouseMove, capture);
  document.addEventListener("mouseup", mouseUp, capture);
  document.addEventListener("keydown", keyDown, capture);
  document.addEventListener("visibilitychange", visibility);
  inputWindow.addEventListener("blur", blur);
  element.addEventListener("lostpointercapture", lostCapture);
  try { element.setPointerCapture(id); } catch { /* Document listeners keep unsupported capture usable. */ }
  if (threshold === 0 && !begin(event)) return null;
  return handle;
}
