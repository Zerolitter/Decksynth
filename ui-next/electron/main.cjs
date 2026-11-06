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
if (PREVIEW) app.setPath('userData',path.join(os.tmpdir(),'decksynth-next-preview'));
let window = null;
let backend = null;
let lastMessage = { bridge: 'starting' };

const COMMANDS = new Set(['perform_set','perform_step','perform_action',
 'midi','select','play','stop','panic','record','undo','quantize',
 'clear','device','audio_device','preset','parameter','edit_note','track','tempo','bars',
 'metronome','save','load','export','save_preset','load_preset']);

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
  backend = spawn('python3', ['-u', path.join(__dirname, 'bridge.py')], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
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
    title: PREVIEW ? 'DeckSynth Next — UI preview' : 'DeckSynth Next',
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
    console.log('DeckSynth Next: UI loaded',window.webContents.getURL());
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
const profile = path.join(UI_ROOT, '.runtime', PREVIEW ? 'preview' : 'live');
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
    console.log('DeckSynth Next: Electron ready; preview='+PREVIEW);
    Menu.setApplicationMenu(null);
    makeWindow();
    startBackend();
  }).catch(error => {
    console.error('DeckSynth Next: initialization failed', error);
    app.exit(1);
  });
  app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
  app.on('window-all-closed', () => app.quit());
  ipcMain.on('deck-snapshot-request', (event) => {
    if (!event.sender.isDestroyed()) event.sender.send('deck-message', lastMessage);
  });
  ipcMain.on('deck-command', (_, command, args) => {
    if (PREVIEW || !backend || !COMMANDS.has(command)) return;
    try { backend.stdin.write(JSON.stringify({ cmd: command, args })+'\n'); }
    catch (error) { publish({ error: 'Command bridge unavailable' }); }
  });
  ipcMain.handle('deck-file-dialog', async (_, operation, extension) => {
    if (PREVIEW) return null;
    const extensions = { project: 'decksynth', midi: 'mid', instrument: 'dspreset' };
    if (!['save','open'].includes(operation) || !(extension in extensions)) return null;
    const ext = extensions[extension];
    const options = {
      title: operation === 'save' ? 'Save DeckSynth '+extension : 'Open DeckSynth '+extension,
      defaultPath: path.join(os.homedir(), 'Music'),
      filters: [{ name: 'DeckSynth '+extension, extensions: [ext] }],
    };
    if (operation === 'save') {
      const result = await dialog.showSaveDialog(window, options);
      return result.canceled ? null : result.filePath;
    }
    const result = await dialog.showOpenDialog(window, { ...options, properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
}
