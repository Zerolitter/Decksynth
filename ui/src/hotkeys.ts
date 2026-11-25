/* One shared key map (Sir, 25 Nov, Settings redesign).
   App (transport), the note editor, the pattern library, the sample editor, Settings › Hotkeys and Help all read this list, so Help always shows
   the keys you really have. Only the keys you changed are stored (with the other settings, `AppSettings.keys`); everything else is the default below.

   Scopes: 'transport' keys work everywhere; a panel's keys only work in that panel. A panel key may not take a transport key (and the other way
   round), two keys of one scope may not be the same, and a clash is caught before it is saved. The few shipped overlaps (Space, Ctrl+Z) stay,
   because the panel that owns the focus wins them. */

export type KeyScope = 'transport' | 'notes' | 'library' | 'sample';
export type KeyAction = { id: string; scope: KeyScope; label: string; about: string; keys: string[] };
/** A row that is listed but cannot be changed: a mouse or touch gesture, or a key the window itself owns. */
export type FixedRow = { scope: KeyScope; keys: string; about: string };

export const SCOPES: { id: KeyScope; title: string; help: string }[] = [
  { id: 'transport', title: 'Transport and tracks', help: 'Work everywhere.' },
  { id: 'notes', title: 'Note editor', help: 'Work while the note grid has the focus.' },
  { id: 'library', title: 'Pattern library', help: 'Work while the library is open.' },
  { id: 'sample', title: 'Sample editor', help: 'Work while the waveform has the focus.' },
];

export const ACTIONS: KeyAction[] = [
  { id: 'transport.play', scope: 'transport', label: 'Play or pause', about: 'Play or pause. Space keeps its normal action on focused controls.', keys: ['F5', 'Space'] },
  { id: 'transport.stop', scope: 'transport', label: 'Stop', about: 'Stop.', keys: ['F6'] },
  { id: 'transport.record', scope: 'transport', label: 'Record', about: 'Start or finish recording.', keys: ['F7'] },
  { id: 'transport.prev', scope: 'transport', label: 'Previous track', about: 'Select the previous track.', keys: ['F8'] },
  { id: 'transport.next', scope: 'transport', label: 'Next track', about: 'Select the next track.', keys: ['F9'] },
  { id: 'transport.undo', scope: 'transport', label: 'Undo', about: 'Undo the latest committed edit.', keys: ['F10', 'Ctrl+Z'] },
  { id: 'transport.redo', scope: 'transport', label: 'Redo', about: 'Redo the latest undone edit.', keys: ['Ctrl+Shift+Z'] },

  { id: 'notes.selectAll', scope: 'notes', label: 'Select all', about: 'Select all notes in the current pattern or clip.', keys: ['Ctrl+A'] },
  { id: 'notes.selectRow', scope: 'notes', label: 'Select the pitch row', about: 'Select the focused note’s exact pitch row, including off-screen time.', keys: ['Ctrl+Shift+A'] },
  { id: 'notes.copy', scope: 'notes', label: 'Copy', about: 'Copy selected notes.', keys: ['Ctrl+C'] },
  { id: 'notes.cut', scope: 'notes', label: 'Cut', about: 'Cut selected notes.', keys: ['Ctrl+X'] },
  { id: 'notes.paste', scope: 'notes', label: 'Paste', about: 'Paste at the edit cursor.', keys: ['Ctrl+V'] },
  { id: 'notes.duplicate', scope: 'notes', label: 'Duplicate', about: 'Duplicate selected notes into a free position.', keys: ['Ctrl+D'] },
  { id: 'notes.delete', scope: 'notes', label: 'Delete', about: 'Delete selected notes.', keys: ['Delete', 'Backspace'] },
  { id: 'notes.legato', scope: 'notes', label: 'Legato', about: 'Legato selected notes, or every note when nothing is selected.', keys: ['Ctrl+L'] },
  { id: 'notes.quantize', scope: 'notes', label: 'Quantize', about: 'Quantize selected notes, or every note when nothing is selected.', keys: ['Q'] },
  { id: 'notes.toolSelect', scope: 'notes', label: 'Select tool', about: 'Switch to the Select tool.', keys: ['1'] },
  { id: 'notes.toolDraw', scope: 'notes', label: 'Draw tool', about: 'Switch to the Draw tool.', keys: ['2'] },
  { id: 'notes.toolErase', scope: 'notes', label: 'Erase tool', about: 'Switch to the Erase tool.', keys: ['3'] },
  { id: 'notes.left', scope: 'notes', label: 'Move earlier', about: 'Move selected notes (or the cursor) one displayed snap earlier.', keys: ['Left'] },
  { id: 'notes.right', scope: 'notes', label: 'Move later', about: 'Move selected notes one displayed snap later.', keys: ['Right'] },
  { id: 'notes.up', scope: 'notes', label: 'Up a semitone', about: 'Move selected notes one semitone up.', keys: ['Up'] },
  { id: 'notes.down', scope: 'notes', label: 'Down a semitone', about: 'Move selected notes one semitone down.', keys: ['Down'] },
  { id: 'notes.octUp', scope: 'notes', label: 'Up an octave', about: 'Move selected notes one octave up.', keys: ['Ctrl+Up'] },
  { id: 'notes.octDown', scope: 'notes', label: 'Down an octave', about: 'Move selected notes one octave down.', keys: ['Ctrl+Down'] },
  { id: 'notes.shorter', scope: 'notes', label: 'Shorten', about: 'Shorten selected notes by one snap.', keys: ['Shift+Left'] },
  { id: 'notes.longer', scope: 'notes', label: 'Lengthen', about: 'Lengthen selected notes by one snap.', keys: ['Shift+Right'] },

  { id: 'library.hear', scope: 'library', label: 'Hear a pattern', about: 'Hear the chosen pattern (again stops it).', keys: ['Space'] },
  { id: 'library.load', scope: 'library', label: 'Load into the slot', about: 'Load it into the selected pattern slot.', keys: ['Enter'] },
  { id: 'library.add', scope: 'library', label: 'Add to the Structure', about: 'Add it to the end of the Structure.', keys: ['A', '+', 'Shift+Enter'] },
  { id: 'library.search', scope: 'library', label: 'Search', about: 'Search. Esc clears the search, then closes the library.', keys: ['Ctrl+F', '/'] },
  { id: 'library.duplicate', scope: 'library', label: 'Duplicate the part', about: 'Structure part: duplicate it.', keys: ['Ctrl+D'] },
  { id: 'library.remove', scope: 'library', label: 'Remove the part', about: 'Structure part: remove it (the pattern itself stays). With a pattern chosen: let go of it.', keys: ['Backspace', 'Delete'] },

  { id: 'sample.fit', scope: 'sample', label: 'Fit the whole sample', about: 'Show the whole sample.', keys: ['F'] },
  { id: 'sample.zoomSlice', scope: 'sample', label: 'Zoom to the slice', about: 'Zoom to the chosen slice.', keys: ['Z'] },
  { id: 'sample.zoomIn', scope: 'sample', label: 'Zoom in', about: 'Zoom in.', keys: ['+', '='] },
  { id: 'sample.zoomOut', scope: 'sample', label: 'Zoom out', about: 'Zoom out.', keys: ['-', '_'] },
  { id: 'sample.split', scope: 'sample', label: 'Split', about: 'Split at the last tap.', keys: ['S'] },
  { id: 'sample.join', scope: 'sample', label: 'Join with the next', about: 'Join the slice with the next one.', keys: ['J'] },
  { id: 'sample.remove', scope: 'sample', label: 'Remove the slice edge', about: 'Remove the slice\'s start edge.', keys: ['Delete', 'Backspace'] },
  { id: 'sample.audition', scope: 'sample', label: 'Play the slice', about: 'Play the chosen slice.', keys: ['Space', 'Enter'] },
];

export const FIXED: FixedRow[] = [
  { scope: 'transport', keys: 'F11', about: 'Full screen on or off (the window owns this key).' },
  { scope: 'transport', keys: 'Ctrl+Q', about: 'Quit Decksynth (the window owns this key).' },
  { scope: 'transport', keys: 'Ctrl+Z / Ctrl+Shift+Z', about: 'Also undo / redo inside the note editor and the library.' },
  { scope: 'notes', keys: 'Escape', about: 'Cancel an active gesture; otherwise clear selection or close the current dialog.' },
  { scope: 'notes', keys: 'Ctrl+drag · empty grid', about: 'Select a rectangle in either Draw or Select mode.' },
  { scope: 'notes', keys: 'Ctrl+drag · selected notes', about: 'Preview a group copy; release commits once.' },
  { scope: 'notes', keys: 'Shift+click', about: 'Add or remove a note from the selection.' },
  { scope: 'notes', keys: 'Pitch key / note drag', about: 'Scrub pitch keys or drag existing notes to audition successive pitches. Drag a note’s end to resize it.' },
  { scope: 'notes', keys: 'Alt+drag', about: 'Temporarily place or move notes off the displayed snap.' },
  { scope: 'notes', keys: 'Snap', about: 'Toggle grid snapping. The Follow control keeps the playhead in view.' },
  { scope: 'notes', keys: 'Velocity lane', about: 'Drag stems or paint across notes; Shift draws a straight velocity line.' },
  { scope: 'notes', keys: 'Ctrl+wheel / Alt+wheel', about: 'Zoom time / change pitch-row density around the pointer.' },
  { scope: 'notes', keys: 'Fit', about: 'Frame selected notes, or all notes when none are selected.' },
  { scope: 'notes', keys: 'Right-click / touch-hold / Shift+F10', about: 'Open contextual commands for the current target.' },
  { scope: 'library', keys: 'Click · double-click', about: 'Hear a pattern · load it into the selected pattern slot.' },
  { scope: 'library', keys: 'Arrow keys / Page Up / Page Down', about: 'Move through the cards and pages; ↓ from the last row goes to the Structure.' },
  { scope: 'library', keys: 'Structure part: ← / →', about: 'Select the part before or after.' },
  { scope: 'library', keys: 'Structure part: Alt+← / Alt+→, or drag', about: 'Move the part earlier or later.' },
  { scope: 'library', keys: 'Structure part: 1–9, + / −, mouse wheel', about: 'How many times the part plays in a row.' },
  { scope: 'library', keys: 'Esc / a press anywhere outside', about: 'Close the library.' },
  { scope: 'sample', keys: 'Wheel / Shift+wheel', about: 'Scroll the waveform (when zoomed); Shift scrolls further.' },
  { scope: 'sample', keys: 'Ctrl+wheel', about: 'Zoom in or out around the pointer.' },
  { scope: 'sample', keys: 'Middle drag / drag when zoomed', about: 'Pan the waveform. On touch: one finger pans, two fingers pinch to zoom.' },
  { scope: 'sample', keys: 'Tap · double-click', about: 'Choose and hear a slice · split the slice where you double-click.' },
  { scope: 'sample', keys: 'Drag a tag marker', about: 'Move Start, End, Loop, Loop end or a slice edge. A shared slice edge moves both slices.' },
  { scope: 'sample', keys: '← / → on the waveform', about: 'Previous / next slice (and hear it).' },
  { scope: 'sample', keys: '← / → on a marker', about: 'Nudge it 1% of the view; Shift 10%, Ctrl 0.1%.' },
  { scope: 'sample', keys: 'Right-click / touch-hold', about: 'Radial menu: Zoom in / out / Fit whole; in Chop also Split here, Join next, Audition, Save to library and Clear slices (the sample stays).' },
];

export type KeyOverrides = Record<string, string[]>;
const byId = new Map(ACTIONS.map(a => [a.id, a]));
export const action = (id: string) => byId.get(id);

/* ---------- the live map (module state; Settings changes it, everything else reads it) ---------- */
let overrides: KeyOverrides = {};
const listeners = new Set<() => void>();
export function cleanOverrides(raw: unknown): KeyOverrides {
  const out: KeyOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!byId.has(id) || !Array.isArray(v)) continue;
    const keys = [...new Set(v.filter((k): k is string => typeof k === 'string' && k.length > 0))];
    if (keys.length && keys.join('|') !== byId.get(id)!.keys.join('|')) out[id] = keys;
  }
  return out;
}
export function setOverrides(next: unknown) {
  const clean = cleanOverrides(next);
  if (JSON.stringify(clean) === JSON.stringify(overrides)) return;
  overrides = clean; listeners.forEach(f => f());
}
export const getOverrides = () => overrides;
export function subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
export function keysOf(id: string, map: KeyOverrides = overrides): string[] { return map[id] ?? byId.get(id)?.keys ?? []; }
export const isChanged = (id: string, map: KeyOverrides = overrides) => !!map[id];

// The saved map is read once at load so a component works before App has pushed the settings in.
try { setOverrides((JSON.parse(localStorage.getItem('decksynth.settings') || '{}') as { keys?: unknown }).keys); } catch { /* optional */ }

/* ---------- key names ---------- */
const NAMES: Record<string, string> = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Esc: 'Escape' };
type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean };
/** 'Ctrl+Shift+Z' style name of a key press, or null for a bare modifier. Shift only counts for named keys (arrows, F-keys, Enter) or beside Ctrl / Alt. */
export function comboOf(e: KeyLike): string | null {
  const key = e.key;
  if (!key || ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return null;
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  const ctrl = !!(e.ctrlKey || e.metaKey), alt = !!e.altKey, printable = key.length === 1 && key !== ' ';
  const shift = !!e.shiftKey && (!printable || ctrl || alt);
  return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', name].filter(Boolean).join('+');
}
/** Does this key press trigger the action (with the user's keys)? */
export function matches(e: KeyLike, id: string): boolean {
  const c = comboOf(e); return c !== null && keysOf(id).includes(c);
}
/** Which action(s) of the given scope does this key press trigger? */
export function actionFor(e: KeyLike, scope: KeyScope): string | null {
  const c = comboOf(e); if (c === null) return null;
  return ACTIONS.find(a => a.scope === scope && keysOf(a.id).includes(c))?.id ?? null;
}
/** The key as shown to people: arrows as arrows. */
export function show(combo: string): string {
  return combo.replace(/\bLeft$/, '←').replace(/\bRight$/, '→').replace(/\bUp$/, '↑').replace(/\bDown$/, '↓');
}
export const showAll = (id: string) => keysOf(id).map(show).join(' / ');

/* ---------- editing ---------- */
/** Why `combo` cannot be used for `id`: the action it clashes with, or null when it is free. */
export function conflict(id: string, combo: string, map: KeyOverrides = overrides): KeyAction | null {
  const me = byId.get(id); if (!me) return null;
  for (const other of ACTIONS) {
    if (other.id === id || !keysOf(other.id, map).includes(combo)) continue;
    const shipped = me.keys.includes(combo) && other.keys.includes(combo);       // Space and Ctrl+Z were shared before
    if (shipped) continue;
    if (other.scope === me.scope || other.scope === 'transport' || me.scope === 'transport') return other;
  }
  return null;
}
/** Changes one action's keys. Returns an error sentence, or the new map. */
export function withKeys(map: KeyOverrides, id: string, keys: string[]): KeyOverrides {
  const next = { ...map }, a = byId.get(id)!;
  if (!keys.length || keys.join('|') === a.keys.join('|')) delete next[id]; else next[id] = keys;
  return next;
}

/** Keys the window or the context menu own. */
export const RESERVED = ['Escape', 'F11', 'Ctrl+Q', 'Shift+F10'];
/** A sentence saying why `combo` can't be used for `id`, or null when it can. */
export function problem(id: string, combo: string, map: KeyOverrides = overrides): string | null {
  if (RESERVED.includes(combo)) return show(combo) + ' belongs to the window.';
  if (keysOf(id, map).includes(combo)) return show(combo) + ' is already on this row.';
  const c = conflict(id, combo, map);
  return c ? show(combo) + ' is already used by “' + c.label + '” (' + (SCOPES.find(s => s.id === c.scope)?.title ?? '') + ').' : null;
}
