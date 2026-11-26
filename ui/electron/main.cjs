'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { readFileSync, mkdirSync, appendFileSync, statSync, renameSync } = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const UI_ROOT = path.resolve(__dirname, '..');
const PREVIEW = process.env.DECKSYNTH_UI_PREVIEW === '1';
// DECKSYNTH_WINDOWED=1 keeps the normal window with a title bar.
const BORDERLESS = !PREVIEW && process.env.DECKSYNTH_WINDOWED !== '1';
// Separate Electron's preview lock/settings from the live MIDI workstation.
if (PREVIEW) app.setPath('userData',path.join(os.tmpdir(),'decksynth-preview'));
let window = null;
let backend = null;
let lastMessage = { bridge: 'starting' };
let lastStatus = null;


// Event log (25 Nov, blank window): ui-events.log in the app's data folder (ui/.runtime/live), one line per
// event with a timestamp and a memory note, capped at 200 KB (the older half moves to ui-events.log.1).
function memoryNote() {
  const mb = n => Math.round(n / 1048576);
  let note = 'free ' + mb(os.freemem()) + '/' + mb(os.totalmem()) + ' MB';
  try { note += ', main rss ' + mb(process.memoryUsage().rss) + ' MB'; } catch {}
  try { note += ', app ' + app.getAppMetrics().map(m => m.type + ' ' + mb((m.memory.workingSetSize || 0) * 1024) + ' MB').join(', '); } catch {}
  return note;
}
function logEvent(text) {
  try {
    const file = path.join(app.getPath('userData'), 'ui-events.log');
    try { if (statSync(file).size > 200 * 1024) renameSync(file, file + '.1'); } catch {}
    appendFileSync(file, new Date().toISOString() + ' ' + text + ' [' + memoryNote() + ']\n');
  } catch {}
  console.error('Decksynth:', text);
}
process.on('uncaughtException', error => logEvent('uncaught exception: ' + (error && error.stack || error)));
process.on('unhandledRejection', reason => logEvent('unhandled rejection: ' + (reason && reason.stack || reason)));
// Reload a dead page at most 3 times in 2 minutes; after that leave it and say so (a loop would only hide the cause).
const reloads = [];
function reloadAllowed() {
  const now = Date.now();
  while (reloads.length && now - reloads[0] > 120000) reloads.shift();
  if (reloads.length >= 3) return false;
  reloads.push(now); return true;
}

const COMMANDS = new Set(['drum_library_root','drum_library_refresh','drum_load_folder',
 'drum_list_samples','drum_preview_sample','drum_preview_stop','drum_replace_sample','set_device','drum_note','drum_edit','drum_draft','drum_clear','drum_crop','drum_export','drum_import','sampler_make','sampler_edit','sampler_recipe','sampler_live','sampler_detect','sampler_load_wav','sampler_clear','add_track','remove_track','sample_save','sample_library_folder','sample_library_scan','sample_library_browse','sample_library_preview','sample_library_stop','sample_library_load','sampler_chop','sampler_view','sampler_audition','sampler_audition_stop','sampler_send','sampler_slice_roots','sampler_inputs','sampler_record','sampler_live_input','sampler_hold','to_grain','session','song','clip','perform_set','perform_step','perform_action',
 'midi','sound_gesture','sound_undo','sound_ab','automation_arm','automation','learn_cc','unlearn_cc','cancel_cc_learn','select','play','stop','panic','record','record_options','preset_options','audio_latency','undo','redo','quantize','import_midi','midi_channels','play_from',
 'clear','device','audio_device','preset','parameter','edit_note','note_edit','editor_note','catalog_action','structure_add','structure_load','structure_set','structure_merge','structure_part_length','structure_extend','track','send','send_setting','bus_set','bus_chain','bus_add','bus_remove','tempo','bars','fx','fx_reorder','spectral_seed', 'layer_file', 'layer_partials','cleanup',
 'meters_watched','metronome','save','load','export','export_wav','export_loop','freeze','unfreeze','save_preset','load_preset']);

// Status messages from the engine carry only what changed; keep the merged whole for a window that (re)loads.
function isStatus(message) {
  return message && typeof message === 'object' && !message.error && !message.message && !message.bridge;
}
function publish(message) {
  lastMessage = isStatus(message) ? (lastStatus = { ...(lastStatus || {}), ...message }) : message;
  if (window && !window.isDestroyed()) window.webContents.send('deck-message', message);
}

function startBackend() {
  if (PREVIEW) {
    const fixturePath = path.join(UI_ROOT, 'src', 'preview-state.json');
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    publish({ bridge: 'ready', preview: true });
    publish({ ...fixture, preview: true });
    return;
  }
  backend = spawn(process.env.DECKSYNTH_PYTHON || 'python3', ['-u', path.join(__dirname, 'bridge.py')], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DECKSYNTH_DEMO_KITS_DIR: path.join(UI_ROOT, 'demo-kits') },
  });
  let stdout = '';
  backend.stdout.setEncoding('utf8');
  backend.stdout.on('data', part => {
    stdout += part;
    let pos;
    while ((pos = stdout.indexOf('\n')) !== -1) {
      const line = stdout.slice(0, pos).trim();
      stdout = stdout.slice(pos + 1);
      if (!line) continue;
      try { publish(JSON.parse(line)); }
      catch { publish({ error: 'Unparseable audio bridge message' }); }
    }
  });
  let stderr = '';
  backend.stderr.setEncoding('utf8');
  backend.stderr.on('data', part => {
    stderr += part;
    if (stderr.length > 12000) stderr = stderr.slice(-8000);
    // Stderr stays available in terminal logs; avoid replacing live status on warnings.
    process.stderr.write(part);
  });
  backend.on('error', error => publish({ error: 'Audio bridge could not launch: '+error.message }));
  backend.on('exit', code => {
    backend = null;
    if (!app.isQuitting && code !== 0) { logEvent('audio bridge exited (' + code + ')'); publish({ error: 'Audio bridge exited ('+code+')' }); }
  });
}

// The UI is laid out for the Deck's 1280x800 panel. When the desktop scale is above 100 %
// (Sir set 135 % on 24 Nov), the window gets fewer logical pixels, so zoom the page down to fit.
function fitZoom() {
  if (!window || window.isDestroyed()) return;
  const area = screen.getDisplayMatching(window.getBounds()).size;
  const zoom = Math.min(1, area.width / 1280, area.height / 800);
  window.webContents.setZoomFactor(zoom);
}

function makeWindow() {
  const area = screen.getPrimaryDisplay().size;
  window = new BrowserWindow({
    width: Math.min(1280, area.width), height: Math.min(746, area.height),
    minWidth: Math.min(1024, area.width), minHeight: Math.min(650, area.height),
    backgroundColor: '#111315', show: false, autoHideMenuBar: true,
    // Sir, 16 Nov: no title bar; the app fills the screen. Quit and Minimise are in Settings, F11 toggles full screen.
    frame: !BORDERLESS,
    title: PREVIEW ? 'Decksynth — UI preview' : 'Decksynth',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const safePage = 'file://' + path.join(UI_ROOT, 'dist', 'index.html');
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== safePage) event.preventDefault();
  });
  // A blank window (25 Nov): the page died or hung while the engine kept playing. Log it, and load the
  // page again; the engine keeps running and the reloaded page gets its whole state (lastStatus). F5 does the same.
  const logUi = logEvent;
  let hung = null;
  const reloadPage = why => {
    if (!window || window.isDestroyed()) return;
    if (!reloadAllowed()) { logUi('not reloading again (3 reloads in 2 minutes: ' + why + '); the engine is still running, F5 tries once more'); return; }
    window.webContents.reload();
  };
  window.webContents.on('render-process-gone', (_, details) => {
    logUi('page gone: ' + details.reason + ' (exit ' + details.exitCode + '); reloading');
    setTimeout(() => reloadPage('page gone'), 500);
  });
  window.on('unresponsive', () => {
    logUi('page not responding');
    clearTimeout(hung);
    hung = setTimeout(() => { if (window && !window.isDestroyed()) { logUi('still not responding after 8 s; reloading'); window.webContents.forcefullyCrashRenderer(); } }, 8000);
  });
  window.on('responsive', () => { if (hung) { clearTimeout(hung); hung = null; } logUi('page responding again'); });
  window.webContents.on('console-message', (event, level, message) => { const lv = event.level ?? level, text = event.message ?? message;
    if (lv === 'error' || lv === 3) logUi('page error: '+String(text).slice(0, 400)); });
  window.webContents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
    logUi('page failed to load: ' + code + ' ' + description + (isMainFrame === false ? ' (sub frame)' : ''));
    if (isMainFrame !== false && code !== -3) setTimeout(() => reloadPage('load failed'), 1000);
  });
  window.webContents.on('did-finish-load', () => {
    console.log('Decksynth: UI loaded',window.webContents.getURL());
    fitZoom();
    window.webContents.send('deck-message', lastStatus || lastMessage);
    if (!window.isVisible()) { window.maximize(); window.show(); }
  });
  window.loadFile(path.join(UI_ROOT, 'dist', 'index.html')).catch(error => {
    console.error('Cannot load DeckSynth UI', error);
    if (window && !window.isDestroyed()) window.show();
  });
  window.once('ready-to-show', () => {
    window.maximize();
    if (BORDERLESS) window.setFullScreen(true);
    window.show();
  });
  screen.on('display-metrics-changed', fitZoom);
  window.on('move', fitZoom);
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { event.preventDefault(); window.webContents.reload(); }
    else if (input.key === 'F11') { event.preventDefault(); window.setFullScreen(!window.isFullScreen()); }
    else if (input.control && !input.alt && (input.key === 'q' || input.key === 'Q')) { event.preventDefault(); app.quit(); }
  });
}

function stopBackend() {
  const child = backend;
  backend = null;
  if (!child) return;
  try { child.stdin.end(); } catch {}
  setTimeout(() => { if (!child.killed) child.kill('SIGTERM'); }, 1500).unref();
}

// A preview must never prevent the live musician's window from launching.
const runtimeRoot = process.env.DECKSYNTH_RUNTIME_DIR || path.join(UI_ROOT, '.runtime');
const profile = path.join(runtimeRoot, PREVIEW ? 'preview' : 'live');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.isQuitting = false;
// Preview is isolated from the musician's running window and may coexist safely.
if (!PREVIEW && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.whenReady().then(() => {
    console.log('Decksynth: Electron ready; preview='+PREVIEW);
    Menu.setApplicationMenu(null);
    makeWindow();
    startBackend();
  }).catch(error => {
    console.error('Decksynth: initialization failed', error);
    app.exit(1);
  });
  app.on('child-process-gone', (_, details) => logEvent(details.type + ' process gone: ' + details.reason + ' (exit ' + details.exitCode + ')'));
  app.on('render-process-gone', (_, __, details) => logEvent('renderer gone (app): ' + details.reason));
  app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
  app.on('window-all-closed', () => app.quit());
  ipcMain.on('deck-window', (event, op) => {
    if (!window || event.sender !== window.webContents) return;
    if (op === 'quit') app.quit();
    else if (op === 'fullscreen') window.setFullScreen(!window.isFullScreen());
    else if (op === 'minimize') { if (window.isFullScreen()) window.setFullScreen(false); window.minimize(); }
  });
  ipcMain.on('deck-snapshot-request', (event) => {
    if (!event.sender.isDestroyed()) event.sender.send('deck-message', lastStatus || lastMessage);
  });
  ipcMain.on('deck-command', (event, command, args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (PREVIEW || !backend) return;
    // A page newer than this window (built while the app was open) can send an action the running app doesn't know yet: say so, don't drop it silently.
    if (!COMMANDS.has(command)) { publish({ error: 'Restart Decksynth to use this ('+String(command).slice(0, 40)+'): the app was updated while it was open' }); return; }
    try { backend.stdin.write(JSON.stringify({ cmd: command, args })+'\n'); }
    catch (error) { publish({ error: 'Command bridge unavailable' }); }
  });
  ipcMain.handle('deck-file-dialog', async (event, operation, extension, name) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return null;
    if (PREVIEW) return null;
    if (operation === 'open' && extension === 'sample_folder') {
      const result = await dialog.showOpenDialog(window, { title: 'Choose your sample library folder',
        properties: ['openDirectory'], defaultPath: os.homedir() });
      return result.canceled ? null : result.filePaths[0];
    }
    const extensions = { project: 'decksynth', midi: 'mid', wav:'wav', instrument: 'dspreset', sample: 'wav' };
    if (!['save','open'].includes(operation) || !(extension in extensions)) return null;
    const ext = extensions[extension];
    const options = {
      title: operation === 'save' ? 'Save Decksynth '+extension : 'Open Decksynth '+extension,
      // A suggested file name (save only): a plain name, never a path.
      defaultPath: path.join(os.homedir(), 'Music', operation === 'save' && typeof name === 'string' && /^[\w .-]{1,120}$/.test(name) && !name.startsWith('.') ? name : ''),
      filters: [{ name: 'Decksynth '+extension, extensions: [ext] }],
    };
    if (operation === 'save') {
      const result = await dialog.showSaveDialog(window, options);
      return result.canceled ? null : result.filePath;
    }
    const result = await dialog.showOpenDialog(window, { ...options, properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
}
