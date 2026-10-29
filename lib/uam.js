// banjo-nx-installer: the console's shader compiler in WebAssembly (wasm/uam.mjs, built by
// wasm/src/uam/build_wasm_uam.sh from banjo-nx's app/thirdparty/uam). One instance per worker: uam is not reentrant.
export async function loadUam(createUamModule, options = {}) {
  const m = await createUamModule(options);
  m._banjo_uam_init(0);  // uam's default codegen flags: banjo-nx's 1471, as the console and the PC tool
  const enc = new TextEncoder();
  return {
    // stage 0 vertex, 4 fragment; returns { dksh: Uint8Array } or { error: string }
    compile(stage, glsl) {
      const bytes = enc.encode(glsl);
      const src = m._malloc(bytes.length + 1);
      m.HEAPU8.set(bytes, src);
      m.HEAPU8[src + bytes.length] = 0;
      const sizePtr = m._malloc(4);
      const out = m._banjo_uam_compile(stage, src, sizePtr);
      const size = m.HEAPU32[sizePtr >> 2];
      m._free(src);
      m._free(sizePtr);
      if (!out) return { error: m.UTF8ToString(m._banjo_uam_log()) };
      const dksh = m.HEAPU8.slice(out, out + size);
      m._banjo_uam_free(out);
      return { dksh };
    },
  };
}
