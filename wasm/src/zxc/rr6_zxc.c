// rr6-nx-installer (2026-11-11): ZXC for lib/lz4b.js: every game file but the RRM archives, packed as ZXC level 7 in
// 512 KB blocks (version 2 of rr6-nx's .lz4b container: sdk/include/rex/filesystem/lz4_blocks.h). ZXC 0.15.0's sources
// in this folder, unmodified (rr6-nx's sdk/thirdparty/zxc holds the same commit and decodes them on the console).
//
// zxc_pack(src, src_size, dst, dst_capacity, level, block_size): one block through zxc_compress_block; returns the
// compressed size, or 0 when it fails or is not smaller than the block (the caller then stores the block as it is).
#include <stdint.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>
#include "zxc.h"

#define EXPORT EMSCRIPTEN_KEEPALIVE

static zxc_cctx* g_cctx;
static int g_level = -1;
static int g_block = -1;

EXPORT void* zxc_malloc(int size) { return malloc((size_t)size); }
EXPORT void zxc_free(void* p) { free(p); }

EXPORT int zxc_pack(const void* src, int src_size, void* dst, int dst_capacity, int level, int block_size) {
  if (!g_cctx) g_cctx = zxc_create_cctx();
  if (!g_cctx) return 0;
  if (level != g_level || block_size != g_block) {
    zxc_cctx_reset(g_cctx);
    if (zxc_cctx_set_param(g_cctx, ZXC_C_LEVEL, level) != ZXC_OK ||
        zxc_cctx_set_param(g_cctx, ZXC_C_BLOCK_SIZE, block_size) != ZXC_OK) {
      g_level = g_block = -1;
      return 0;
    }
    g_level = level;
    g_block = block_size;
  }
  const int64_t n = zxc_compress_block(g_cctx, src, (size_t)src_size, dst, (size_t)dst_capacity);
  return n > 0 && n < src_size ? (int)n : 0;
}

// The destination's size for one block of `size` bytes.
EXPORT int zxc_bound(int size) { return (int)zxc_compress_block_bound((size_t)size); }

EXPORT int zxc_version(void) { return (int)zxc_version_number(); }
