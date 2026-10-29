#!/usr/bin/env bash
# Builds wasm/renut_hlsl.mjs + .wasm: banjo-nx's Renut shader translator (app/thirdparty/reblue-XenosRecomp, RENUT_RECOMP)
# with wasm/src/translator/renut_hlsl_frontend.cpp (translation only; DXC is its own module). As bejeweled3-nx-installer's
# wasm/src/deko3d/build_wasm_deko3d.sh, with banjo-nx's sources.
#   BANJO_NX   the banjo-nx checkout                  (default: ../banjo-nx next to the installer)
#   EMSDK      an emsdk folder with Emscripten 6.0.11 (default: D:/sonic adventure 2/_tools/emsdk)
#   OUT        output folder                          (default: the installer's wasm/)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
BANJO_NX=${BANJO_NX:-$INSTALLER/../banjo-nx}
BANJO_NX=$(cd "$BANJO_NX" && pwd)
OUT=${OUT:-$INSTALLER/wasm}
mkdir -p "$OUT"
if ! command -v em++ >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")
  [ -f "$EMSDK/.emscripten" ] || { echo "em++ not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
fi
echo "em++: $(em++ --version | head -1)"
XENOS=$BANJO_NX/app/thirdparty/reblue-XenosRecomp/XenosRecomp
XXHASH_DIR=$BANJO_NX/sdk/thirdparty/xxHash
FMT_DIR=$BANJO_NX/sdk/thirdparty/fmt/include
em++ -std=c++20 -O2 -I"$XENOS/.." -I"$XENOS" -I"$FMT_DIR" -I"$XXHASH_DIR" -include "$HERE/renut_hlsl_pch.h" \
  -Wno-null-arithmetic -fms-extensions -DFMT_HEADER_ONLY -DXXH_INLINE_ALL -DRENUT_RECOMP \
  "$HERE/renut_hlsl_frontend.cpp" "$XENOS/shader_recompiler.cpp" -o "$OUT/renut_hlsl.mjs" \
  -sEXPORT_NAME=createRenutHlslModule -sEXPORT_ES6=1 -sMODULARIZE=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=4MB -sEXPORTED_RUNTIME_METHODS=FS,callMain -sENVIRONMENT=web,worker,node
ls -la "$OUT/renut_hlsl.mjs" "$OUT/renut_hlsl.wasm"
