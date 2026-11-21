#!/usr/bin/env bash
# nights-nx-installer (2026-11-22, culdcept-nx-installer's wasm/src/wmv3/build.sh): builds wasm/vc1.mjs + wasm/vc1.wasm,
# FFmpeg's VC-1 and WMV3 decoders for the movies' H.265 re-encode, from:
#   vc1_wasm.c    this folder: the exports (vc1_open, vc1_decode, vc1_first, vc1_picture, vc1_close, vc1_malloc,
#                 vc1_free, vc1_version)
#   FFmpeg 4.4    nights-nx's sdk/thirdparty/FFmpeg (FFMPEG_SRC), configured out of its tree (BUILD) with the VC-1 and
#                 WMV3 decoders only: no assembly, no threads, no programs (LGPL-2.1-or-later: the VC-1 decoder)
#   Emscripten    emcc on PATH, or
#   EMSDK         an emsdk folder (used when emcc is not on PATH; default: D:/sonic adventure 2/_tools/emsdk)
#   MAKE          GNU make (default: devkitPro's msys2 make)
# Outputs: wasm/vc1.mjs, wasm/vc1.wasm (OUT to change the folder).
#
# usage: wasm/src/vc1/build.sh   (Git Bash)
set -eu
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INSTALLER=$(cd "$HERE/../../.." && pwd)
OUT=${OUT:-$INSTALLER/wasm}
FFMPEG_SRC=${FFMPEG_SRC:-/d/nights/nights-nx/sdk/thirdparty/FFmpeg}
BUILD=${BUILD:-/d/nights/tmp_wasm_vc1}
MAKE=${MAKE:-/c/devkitPro/msys2/usr/bin/make}

if ! command -v emcc >/dev/null 2>&1; then
  EMSDK=${EMSDK:-"D:/sonic adventure 2/_tools/emsdk"}
  command -v cygpath >/dev/null 2>&1 && EMSDK=$(cygpath -u "$EMSDK")
  [ -f "$EMSDK/.emscripten" ] || { echo "emcc not found and no emsdk at $EMSDK: set EMSDK" >&2; exit 1; }
  export EM_CONFIG="$EMSDK/.emscripten"
  for d in "$EMSDK"/python/*/ "$EMSDK"/node/*/; do PATH="$d:$PATH"; done
  PATH="$EMSDK/upstream/emscripten:$PATH"
  export PATH
fi
echo "emcc: $(emcc --version | head -1)"

# nights-nx's FFmpeg folder holds the SDK's own config.h, so configure will not build out of its tree: a copy of the
# source in $BUILD/src without it, configured in place.
if [ ! -f "$BUILD/src/configure" ]; then
  mkdir -p "$BUILD"
  cp -r "$FFMPEG_SRC" "$BUILD/src"
  rm -f "$BUILD/src/config.h"
fi
mkdir -p "$BUILD/tmp"
export TMPDIR="$BUILD/tmp"  # configure's own test files (Windows' %TEMP% loses its backslashes in Git Bash)
cd "$BUILD/src"
FFMPEG_SRC="$BUILD/src"
BUILD="$BUILD/src"
if [ ! -f ffbuild/config.mak ]; then
  ./configure --target-os=none --arch=x86_32 --enable-cross-compile --cc=emcc --cxx=em++ \
    --ar=emar --ranlib=emranlib --nm=emnm --dep-cc=emcc \
    --disable-x86asm --disable-inline-asm --disable-asm --disable-stripping --disable-programs --disable-doc \
    --disable-debug --disable-runtime-cpudetect --disable-autodetect --disable-network --disable-pthreads \
    --disable-w32threads --disable-os2threads --disable-everything --enable-decoder=vc1 --enable-decoder=wmv3 \
    --disable-avdevice --disable-avformat --disable-swresample --disable-swscale --disable-postproc \
    --disable-avfilter --extra-cflags="-O3"
fi
"$MAKE" -j8 libavcodec/libavcodec.a libavutil/libavutil.a

emcc -O3 -I"$BUILD" -I"$FFMPEG_SRC" "$HERE/vc1_wasm.c" "$BUILD/libavcodec/libavcodec.a" "$BUILD/libavutil/libavutil.a" \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_RUNTIME_METHODS=HEAPU8 -s EXPORT_NAME=createVc1Module -o "$OUT/vc1.mjs"
ls -la "$OUT/vc1.mjs" "$OUT/vc1.wasm"
