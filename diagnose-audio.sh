#!/bin/sh
# DeckSynth audio report: the machine, the sound server, and how hard the engine works here.
# Run it with DeckSynth closed:  sh ~/Projects/deck-app/diagnose-audio.sh
# It prints a report and saves it to ~/decksynth-audio-report.txt. Paste that file to Claude.
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/decksynth-audio-report.txt"
{
  echo "=== DeckSynth audio report, $(date)"
  echo; echo "--- Machine"
  grep -m1 'model name' /proc/cpuinfo
  echo "CPU threads: $(nproc)"
  for g in /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor; do [ -r "$g" ] && echo "Governor: $(cat "$g")"; done
  [ -r /sys/class/power_supply/BAT1/status ] && echo "Battery: $(cat /sys/class/power_supply/BAT1/status) $(cat /sys/class/power_supply/BAT1/capacity 2>/dev/null)%"
  echo "Load average: $(cut -d' ' -f1-3 /proc/loadavg)"
  free -h
  echo; echo "--- Biggest programs by memory"
  ps -eo rss,comm --sort=-rss | head -8 | awk 'NR==1{print "   MB  program";next}{printf "%5d  %s\n",$1/1024,$2}'
  echo; echo "--- Sound server"
  (pactl info 2>/dev/null | grep -E 'Server Name|Default Sink|Default Sample') || echo "pactl not available"
  (pw-metadata -n settings 2>/dev/null | grep -E 'clock.(rate|quantum|min-quantum|force-quantum)') || true
  echo; echo "--- Engine"
  cd "$ROOT" && python3 -m decksynth.diagnose
} 2>&1 | tee "$OUT"
echo
echo "Saved to $OUT"
