'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { readFileSync, mkdirSync } = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');
const UI_ROOT = path.resolve(__dirname, '..');
const PREVIEW = process.env.DECKSYNTH_UI_PREVIEW === '1';
// Separate Electron's preview lock/settings from the live MIDI workstation.
if (PREVIEW) app.setPath('userData',path.join(os.tmpdir(),'decksynth-playwright-'+process.pid));
let window = null;
let backend = null;
let lastMessage = { bridge: 'starting' };

const COMMANDS = new Set(['drum_library_root','drum_library_refresh','drum_load_folder',
 'drum_list_samples','drum_preview_sample','drum_preview_stop','drum_replace_sample','set_device','drum_note','drum_edit','drum_draft','drum_clear','drum_crop','drum_export','drum_import','sampler_make','sampler_edit','sampler_recipe','sampler_live','sampler_detect','sampler_load_wav','sampler_clear','add_track','remove_track','sample_save','sample_library_folder','sample_library_scan','sample_library_browse','sample_library_preview','sample_library_stop','sample_library_load','sampler_chop','sampler_view','sampler_audition','sampler_audition_stop','sampler_send','sampler_slice_roots','sampler_inputs','sampler_record','sampler_live_input','sampler_hold','plugin','to_grain','session','song','clip','perform_set','perform_step','perform_action',
 'midi','sound_gesture','sound_undo','sound_ab','automation_arm','automation','learn_cc','unlearn_cc','cancel_cc_learn','select','play','stop','panic','record','record_options','preset_options','undo','redo','quantize','import_midi','midi_channels','play_from',
 'clear','device','audio_device','preset','parameter','edit_note','note_edit','editor_note','catalog_action','structure_add','structure_load','structure_set','structure_merge','structure_part_length','structure_extend','track','send','send_setting','tempo','bars','fx','fx_reorder','spectral_seed', 'layer_file', 'layer_partials','cleanup',
 'bus_set','bus_chain','bus_add','bus_remove','clip_fx','meters_watched',
 'metronome','save','load','export','export_wav','export_loop','freeze','unfreeze','save_preset','load_preset']);

function publish(message) {
  lastMessage = message;
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
    if (!app.isQuitting && code !== 0) publish({ error: 'Audio bridge exited ('+code+')' });
  });
}

function makeWindow() {
  window = new BrowserWindow({
    width: 1280, height: 746, minWidth: 1024, minHeight: 650,
    backgroundColor: '#111315', show: false, autoHideMenuBar: true,
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
  window.webContents.on('did-fail-load', (_, code, description) => {
    console.error('DeckSynth UI failed to load', code, description);
  });
  window.webContents.on('did-finish-load', () => {
    console.log('Decksynth: UI loaded',window.webContents.getURL());
    window.webContents.send('deck-message', lastMessage);
    if (!window.isVisible()) { window.maximize(); window.show(); }
  });
  window.loadFile(path.join(UI_ROOT, 'dist', 'index.html')).catch(error => {
    console.error('Cannot load DeckSynth UI', error);
    if (window && !window.isDestroyed()) window.show();
  });
  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
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
const profile = path.join(require('node:os').tmpdir(), 'decksynth-playwright-'+process.pid);
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.isQuitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
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
  app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
  app.on('window-all-closed', () => app.quit());
  ipcMain.on('deck-window', (event, op) => {
    if (!window || event.sender !== window.webContents) return;
    if (op === 'quit') app.quit();
    else if (op === 'fullscreen') window.setFullScreen(!window.isFullScreen());
    else if (op === 'minimize') window.minimize();
  });
  ipcMain.on('deck-snapshot-request', (event) => {
    if (!event.sender.isDestroyed()) event.sender.send('deck-message', lastMessage);
  });
  ipcMain.on('deck-command', (event, command, args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (PREVIEW || !backend || !COMMANDS.has(command)) return;
    try { backend.stdin.write(JSON.stringify({ cmd: command, args })+'\n'); }
    catch (error) { publish({ error: 'Command bridge unavailable' }); }
  });
  ipcMain.handle('deck-file-dialog', async (event, operation, extension) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return null;
    if (PREVIEW) return null;
    if (operation === 'open' && extension === 'sample_folder') {
      const result = await dialog.showOpenDialog(window, { title: 'Choose your sample library folder',
        properties: ['openDirectory'], defaultPath: os.homedir() });
      return result.canceled ? null : result.filePaths[0];
    }
    const extensions = { project: 'decksynth', midi: 'mid', instrument: 'dspreset', sample: 'wav' };
    if (!['save','open'].includes(operation) || !(extension in extensions)) return null;
    const ext = extensions[extension];
    const options = {
      title: operation === 'save' ? 'Save Decksynth '+extension : 'Open Decksynth '+extension,
      defaultPath: path.join(os.homedir(), 'Music'),
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
