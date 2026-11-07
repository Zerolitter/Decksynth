#!/usr/bin/env python3
"""Build optional Drum Rack native loop into the user cache (or --output path).

Examples:
    python3 tools/build-native-drums.py
    CC='/path/to/zig cc' python3 tools/build-native-drums.py --force
The generated .so is a local cache artifact, never a source asset to commit.
"""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from decksynth.drum_native import build_library


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--force', action='store_true')
    options = parser.parse_args()
    try:
        print(build_library(options.output, options.force))
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
