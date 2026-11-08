'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');

exports.launch = async function launch(slice) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decksynth-' + slice + '-'));
  const env = { ...process.env, DECKSYNTH_DIAGNOSTIC: '1', DECKSYNTH_UI_PREVIEW: '0',
    DECKSYNTH_DATA_DIR: tmp, SDL_AUDIODRIVER: 'dummy' };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const app = await _electron.launch({ cwd: path.resolve(__dirname, '..'),
    args: ['--ozone-platform=headless', '--disable-gpu', 'electron/playwright-main.cjs'], env });
  const page = await app.firstWindow();
  page.setDefaultTimeout(5000);
  await page.waitForFunction(() => document.querySelector('.footer-status')?.textContent?.includes('CONNECTED'));
  await page.evaluate(() => window.deckApi.onMessage(m => { if (m.state) window.usabilityState = m; }));
  await app.evaluate(({ ipcMain }) => {
    globalThis.usabilityCommands = [];
    ipcMain.prependListener('deck-command', (_, cmd, args) => usabilityCommands.push({ cmd, args }));
  });
  const send = (cmd, args) => page.evaluate(([c, a]) => window.deckApi.send(c, a), [cmd, args]);
  const height = async value => {
    await app.evaluate(({ BrowserWindow }, value) => {
      const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setContentSize(1280, value);
    }, value);
    await page.waitForFunction(value => innerWidth === 1280 && innerHeight === value, value);
  };
  const point = async (locator, offset) => {
    const b = await locator.boundingBox(); assert.ok(b);
    return { x: b.x + (offset?.x ?? b.width / 2), y: b.y + (offset?.y ?? b.height / 2) };
  };
  const move = p => page.mouse.move(p.x, p.y);
  const commands = () => app.evaluate(() => usabilityCommands.splice(0));
  const shot = async (name, size) => {
    if (!process.env.DECKSYNTH_SHOTS) return;
    fs.mkdirSync(process.env.DECKSYNTH_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.DECKSYNTH_SHOTS, name + '-1280x' + size + '.png') });
  };
  const close = async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, page, send, height, point, move, commands, shot, close };
};
