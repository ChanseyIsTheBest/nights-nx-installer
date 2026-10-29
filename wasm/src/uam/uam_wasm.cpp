// banjo-nx-installer: uam, the console's shader compiler (banjo-nx's app/thirdparty/uam: devkitPro's uam 1.1.0 with
// SwitchWakerHD's and banjo-nx's patches, PATCHES.md there), for the page's workers. The same source and the same
// codegen flags as the console's and the PC tool's (tools/deko3d_variant_cache.py), so a variant's DKSH is the same
// bytes: the page checks that against the build's manifest (test/uam_node.mjs compares it with the PC tool's).
//
//   banjo_uam_init(flags)                     once per worker (0: uam's own default, banjo-nx's 1471)
//   banjo_uam_compile(stage, glsl, &size)     stage 0 vertex, 4 fragment; a malloc'd DKSH or null (banjo_uam_log())
//   banjo_uam_free(p)
#include <emscripten/emscripten.h>

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#include "uam_api.h"

namespace {
std::string g_log;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void banjo_uam_init(unsigned flags) {
  uam::init(true);  // the resident frontend, as the console's compile worker (plume_deko3d.cpp)
  if (flags) uam::setBanjoFlags(flags);
}

EMSCRIPTEN_KEEPALIVE uint8_t* banjo_uam_compile(int stage, const char* glsl, uint32_t* out_size) {
  const uam::Result r = uam::compile(static_cast<uam::Stage>(stage), glsl);
  g_log = r.log;
  *out_size = 0;
  if (!r.ok || r.dksh.empty()) return nullptr;
  uint8_t* out = static_cast<uint8_t*>(std::malloc(r.dksh.size()));
  if (!out) return nullptr;
  std::memcpy(out, r.dksh.data(), r.dksh.size());
  *out_size = uint32_t(r.dksh.size());
  return out;
}

EMSCRIPTEN_KEEPALIVE const char* banjo_uam_log() { return g_log.c_str(); }

EMSCRIPTEN_KEEPALIVE void banjo_uam_free(void* p) { std::free(p); }

}  // extern "C"
