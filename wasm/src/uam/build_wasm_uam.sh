#!/usr/bin/env bash
# Builds wasm/uam.mjs + uam.wasm: banjo-nx's uam (app/thirdparty/uam) with Emscripten, for the page's compile workers.
#   BANJO_NX   the banjo-nx checkout                      (default: ../banjo-nx next to the installer)
#   EMSDK      an emsdk folder with Emscripten 6.0.11     (default: D:/sonic adventure 2/_tools/emsdk)
#   CMAKE_BIN  folder with cmake and ninja                (default: Visual Studio 18 Build Tools' copies)
#   OUT        output folder                              (default: the installer's wasm/)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
BANJO_NX=${BANJO_NX:-$INSTALLER/../banjo-nx}
BANJO_NX=$(cd "$BANJO_NX" && pwd)
OUT=${OUT:-$INSTALLER/wasm}
BUILD=${BUILD:-$INSTALLER/wasm/src/uam/build}
mkdir -p "$OUT" "$BUILD"
if ! command -v em++ >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")
  [ -f "$EMSDK/.emscripten" ] || { echo "em++ not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
fi
CMAKE_BIN=${CMAKE_BIN:-"/c/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake"}
PATH="$CMAKE_BIN/CMake/bin:$CMAKE_BIN/Ninja:$PATH"
echo "em++: $(em++ --version | head -1)"
UAM=$BANJO_NX/app/thirdparty/uam

# uam's own CMakeLists (the library the console links: uamlib), compiled by Emscripten.
# wasm32 is little-endian; Mesa's p_config.h knows it only by the CPU (x86, ARM): told here, the sources untouched.
emcmake cmake -G Ninja -S "$UAM" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release   "-DCMAKE_C_FLAGS=-DPIPE_ARCH_LITTLE_ENDIAN" "-DCMAKE_CXX_FLAGS=-DPIPE_ARCH_LITTLE_ENDIAN" >/dev/null
cmake --build "$BUILD" --target uamlib -j "${JOBS:-8}"

# Mesa's parser and nv50_ir recurse deeply (8 MB on the Switch): the same stack here. uam reports fatal errors by
# longjmp (PATCHES.md 4): Emscripten's setjmp support is on by default.
em++ -std=c++17 -O2 -I"$UAM" "$HERE/uam_wasm.cpp" "$BUILD/libuamlib.a" -o "$OUT/uam.mjs" \
  -sEXPORT_ES6=1 -sMODULARIZE=1 -sEXPORT_NAME=createUamModule -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sSTACK_SIZE=8MB \
  -sEXPORTED_FUNCTIONS=_banjo_uam_init,_banjo_uam_compile,_banjo_uam_log,_banjo_uam_free,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,stringToUTF8,lengthBytesUTF8,UTF8ToString,HEAPU8,HEAPU32,getValue
ls -la "$OUT/uam.mjs" "$OUT/uam.wasm"
