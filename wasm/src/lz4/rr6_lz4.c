// rr6-nx-installer (2026-11-10): LZ4 HC for lib/lz4b.js, the game's RRM archives packed in 256 KB blocks
// (rr6-nx's sdk/include/rex/filesystem/lz4_blocks.h has the format). LZ4 1.10.0's lz4hc.c, unmodified, in this folder.
//
// lz4_compress(src, src_size, dst, dst_capacity, level): one block in LZ4's block format at that HC level; returns
// the compressed size, or 0 when it does not fit in dst_capacity (the caller then stores the block as it is).
#include <stdint.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>
#include "lz4hc.h"

#define EXPORT EMSCRIPTEN_KEEPALIVE

static void* g_state;

EXPORT void* lz4_malloc(int size) { return malloc((size_t)size); }
EXPORT void lz4_free(void* p) { free(p); }

EXPORT int lz4_compress(const char* src, int src_size, char* dst, int dst_capacity, int level) {
  if (!g_state) g_state = malloc((size_t)LZ4_sizeofStateHC());
  if (!g_state) return 0;
  return LZ4_compress_HC_extStateHC(g_state, src, dst, src_size, dst_capacity, level);
}

EXPORT int lz4_bound(int size) { return LZ4_compressBound(size); }

EXPORT int lz4_version(void) { return LZ4_versionNumber(); }
