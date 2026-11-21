#!/usr/bin/env bash
# Builds wasm/zxc.mjs + wasm/zxc.wasm: ZXC for lib/lz4b.js (every game file but the RRM archives, ZXC 7 in 512 KB
# blocks), from:
#   rr6_zxc.c     this folder: the exports (zxc_pack, zxc_bound, zxc_malloc, zxc_free, zxc_version)
#   include/, src/lib/  ZXC 0.15.0's library (BSD 3-Clause, LICENSE here; rapidhash MIT, THIRD_PARTY_NOTICES), unmodified
#                 but for zxc_driver.c (the threaded FILE pipeline) left out, as ZXC's own Emscripten build does; the same
#                 commit as rr6-nx's sdk/thirdparty/zxc (VERSION.txt)
# Portable C, no SIMD (ZXC_DISABLE_SIMD, as ZXC's CMake sets for Emscripten).
#
#   EMSDK  an emsdk folder (used when emcc is not on PATH; default: D:/sonic adventure 2/_tools/emsdk)
#   OUT    output folder (default: the installer's wasm/)
# usage: wasm/src/zxc/build.sh   (Git Bash)
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
echo "emcc: $(emcc --version | head -1)"

LIB="$HERE/src/lib"
emcc -O3 -std=gnu11 -DZXC_STATIC_DEFINE -DZXC_DISABLE_SIMD -DZXC_FUNCTION_SUFFIX=_default \
  -I"$HERE/include" -I"$LIB" -I"$LIB/vendors" \
  "$HERE/rr6_zxc.c" "$LIB/zxc_common.c" "$LIB/zxc_pivco_tables.c" "$LIB/zxc_dict.c" "$LIB/zxc_dispatch.c" \
  "$LIB/zxc_pstream.c" "$LIB/zxc_seekable.c" "$LIB/zxc_compress.c" "$LIB/zxc_decompress.c" "$LIB/zxc_huffman.c" \
  -o "$OUT/zxc.mjs" \
  -sEXPORT_ES6=1 -sMODULARIZE=1 -sEXPORT_NAME=createZxcModule -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=256MB -sFILESYSTEM=0 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sEXPORTED_FUNCTIONS=_zxc_pack,_zxc_bound,_zxc_malloc,_zxc_free,_zxc_version -sEXPORTED_RUNTIME_METHODS=HEAPU8
ls -l "$OUT/zxc.mjs" "$OUT/zxc.wasm"
