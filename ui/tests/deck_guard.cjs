'use strict';
// Required at the top of every screen test: refuses to open an Electron window while the maintainer's own Decksynth is
// running (tools/deck_busy.sh; DECKSYNTH_ALLOW_BUSY=1 overrides). Skipped when the script is not there.
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const guard = path.resolve(__dirname, '../../tools/deck_busy.sh');
if (fs.existsSync(guard) && process.env.DECKSYNTH_ALLOW_BUSY !== '1') {
  const r = spawnSync('sh', [guard], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status === 75) process.exit(75);
}
