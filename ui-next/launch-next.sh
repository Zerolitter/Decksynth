#!/usr/bin/env bash
# Experimental advanced interface; reuses DeckSynth's existing Python engine.
set -euo pipefail
cd /home/deck/Projects/deck-app/ui-next
if [ -f "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
fi
export PATH="/home/deck/.nvm/versions/node/v26.13.0/bin:$PATH"
unset DECKSYNTH_UI_PREVIEW
exec ./node_modules/electron/dist/electron .
