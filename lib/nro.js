// banjo-nx-installer: the shaders the distribution NRO carries itself (the ones the game makes at runtime, which no
// game file holds): its GLSL package (banjo-nx's tools/deko3d_shader_package.py --only --raw, embedded by the
// assembler as g_deko3dGlslPackage) found in the NRO's bytes. Their variants are compiled with the rest, so the
// console compiles nothing.
//   header (32 bytes): "BDKG", 1, count, 0 (no dictionary), table offset, data offset, 0, 0
//   table: per shader (56 bytes, sorted by hash): u64 hash, u32 offset, compressed size, size, stage, 8 x u32
//   data: one zstd frame of raw blocks per shader

// The content of a zstd frame made only of raw blocks (zstdRawFrame's, and the tool's raw_frame), or null.
function rawFrameContent(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 9 || view.getUint32(0, true) !== 0xfd2fb528 || bytes[4] !== ((2 << 6) | (1 << 5))) return null;
  const size = view.getUint32(5, true);
  const out = new Uint8Array(size);
  let at = 9, filled = 0;
  for (;;) {
    if (at + 3 > bytes.length) return null;
    const header = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    const last = header & 1, type = (header >> 1) & 3, n = header >>> 3;
    at += 3;
    if (type !== 0 || at + n > bytes.length || filled + n > size) return null;
    out.set(bytes.subarray(at, at + n), filled);
    filled += n;
    at += n;
    if (last) break;
  }
  return filled === size ? out : null;
}

function parsePackage(bytes, start) {
  const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.byteLength - start);
  if (view.byteLength < 32 || view.getUint32(4, true) !== 1 || view.getUint32(12, true) !== 0) return null;
  const count = view.getUint32(8, true), table = view.getUint32(16, true), data = view.getUint32(20, true);
  if (count === 0 || count > 100000 || table !== 32 || data !== table + 56 * count || data > view.byteLength) return null;
  const shaders = new Map();
  let previous = -1n;
  for (let i = 0; i < count; ++i) {
    const e = table + 56 * i;
    const hash = view.getBigUint64(e, true);
    const offset = view.getUint32(e + 8, true), csize = view.getUint32(e + 12, true), size = view.getUint32(e + 16, true);
    const stage = view.getUint32(e + 20, true);
    if (hash <= previous || (stage !== 0 && stage !== 4) || data + offset + csize > view.byteLength) return null;
    previous = hash;
    const text = rawFrameContent(bytes.subarray(start + data + offset, start + data + offset + csize));
    if (!text || text.length !== size) return null;
    shaders.set(`${stage === 4 ? 'ps' : 'vs'}_${hash.toString(16).toUpperCase().padStart(16, '0')}`, text);
  }
  return shaders;
}

// nro: the NRO's bytes. Returns Map(stem -> UTF-8 GLSL), empty if the NRO has no such package.
export function nroShaders(nro) {
  for (let at = nro.indexOf(0x42); at >= 0 && at + 32 <= nro.length; at = nro.indexOf(0x42, at + 1)) {
    if (nro[at + 1] !== 0x44 || nro[at + 2] !== 0x4b || nro[at + 3] !== 0x47) continue;  // "BDKG"
    const shaders = parsePackage(nro, at);
    if (shaders) return shaders;
  }
  return new Map();
}
