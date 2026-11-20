#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

compiler=()
if [[ -x .tools/solc-0.8.28 ]]; then
  compiler=(--use .tools/solc-0.8.28)
fi

if [[ "${1:-}" == arc ]]; then
  shift
  if [[ -x .tools/arc-foundry/forge ]]; then
    export DYLD_LIBRARY_PATH="$PWD/.tools/libusb-local/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
    exec .tools/arc-foundry/forge test --offline --network arc "${compiler[@]}" "$@"
  fi
  exec arc-forge test --offline --network arc "${compiler[@]}" "$@"
fi
exec forge test --offline "${compiler[@]}" "$@"
