#!/usr/bin/env bash
# Builds wasm/lz4.mjs + wasm/lz4.wasm: LZ4 HC for lib/lz4b.js (the game's RRM archives packed in 256 KB blocks), from:
#   rr6_lz4.c     this folder: the exports (lz4_compress, lz4_bound, lz4_malloc, lz4_free, lz4_version)
#   lz4.c, lz4.h, lz4hc.c, lz4hc.h  LZ4 1.10.0's lib files (BSD 2-Clause, LICENSE here), unmodified; the copy in
#                 peggle2-nx-installer's wasm/src/hdpack/lz4
#
#   EMSDK  an emsdk folder (used when emcc is not on PATH; default: D:/sonic adventure 2/_tools/emsdk)
#   OUT    output folder (default: the installer's wasm/)
# usage: wasm/src/lz4/build.sh   (Git Bash)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
OUT=${OUT:-$INSTALLER/wasm}

if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")  # Git Bash: PATH entries must be POSIX paths
  [ -f "$EMSDK/.emscripten" ] || { echo "emcc not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
  export PATH
fi
grep -q 'LZ4_VERSION_MINOR *10 ' "$HERE/lz4.h" || echo "warning: $HERE is not LZ4 1.10" >&2
echo "emcc: $(emcc --version | head -1)"

emcc -O3 -std=c17 -I"$HERE" "$HERE/rr6_lz4.c" "$HERE/lz4.c" "$HERE/lz4hc.c" -o "$OUT/lz4.mjs" \
  -sEXPORT_ES6=1 -sMODULARIZE=1 -sEXPORT_NAME=createLz4Module -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB -sFILESYSTEM=0 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=_lz4_compress,_lz4_bound,_lz4_malloc,_lz4_free,_lz4_version -sEXPORTED_RUNTIME_METHODS=HEAPU8
ls -l "$OUT/lz4.mjs" "$OUT/lz4.wasm"
