// banjo-nx-installer: the shader variants the page compiles (release/variants.txt, written by banjo-nx's
// tools/deko3d_variant_cache.py --export-variants): one line per variant, "<vs|ps>_<HASH> <id>=<value>,...", the
// specialization constants that differ from the shader's defaults. A variant's text is its shader's GLSL with
// "#define SPIRV_CROSS_CONSTANT_ID_<id> <value>u" after the first line for each (ids ascending), and its key in the
// console's DKSH cache is the FNV-1a 64 of that text (plume_deko3d's loadVariant; the tool's variant_text / fnv1a64).

export function parseVariants(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const sp = line.indexOf(' ');
    const stem = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
    const pairs = rest ? rest.split(',').map((p) => p.split('=').map(Number)) : [];
    out.push({ stem, stage: stem.startsWith('ps_') ? 4 : 0, pairs });
  }
  return out;
}

export function variantText(glsl, pairs) {
  if (!pairs.length) return glsl;
  const nl = glsl.indexOf('\n');
  if (nl < 0) return glsl;
  let defines = '';
  for (const [id, value] of pairs) defines += `#define SPIRV_CROSS_CONSTANT_ID_${id} ${value >>> 0}u\n`;
  return glsl.slice(0, nl + 1) + defines + glsl.slice(nl + 1);
}

// FNV-1a 64 of UTF-8 bytes, as two 32-bit halves with a BigInt result (BigInt arithmetic per byte took 2 minutes for
// the 900 MB of variant texts). The prime is 2^40 + 0x1B3: h * prime = h * 0x1B3 + (h << 40).
export function fnv1a64(bytes) {
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]) >>> 0;
    const p = lo * 0x1b3;  // < 2^41: exact
    const carry = Math.floor(p / 4294967296);
    hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) >>> 0;
    lo = p >>> 0;
  }
  return (BigInt(hi) << 32n) | BigInt(lo);
}

// The BigInt definition, for the test (test/fnv_node.mjs).
export function fnv1a64Reference(bytes) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < bytes.length; i++) h = ((h ^ BigInt(bytes[i])) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h;
}

// The console's DKSH cache file (banjo-nx's banjo_renut_deko3d.cpp LoadCache): "BDKC", u32 version 1, the 16-byte
// compiler tag, then records (u64 key, u32 size, DKSH), keys ascending as the PC tool writes them.
export const CACHE_TAG = 'uam110-sw8-bnx4\0';

export function readCache(bytes) {
  const map = new Map();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const tag = String.fromCharCode(...bytes.subarray(8, 24));
  if (magic !== 'BDKC' || dv.getUint32(4, true) !== 1 || tag !== CACHE_TAG) throw new Error('not a banjo-nx DKSH cache');
  let at = 24;
  while (at + 12 <= bytes.length) {
    const key = dv.getBigUint64(at, true);
    const size = dv.getUint32(at + 8, true);
    if (at + 12 + size > bytes.length) break;
    map.set(key, bytes.subarray(at + 12, at + 12 + size));
    at += 12 + size;
  }
  return map;
}

export function writeCache(entries) {  // entries: Map(BigInt key -> Uint8Array), written in ascending key order
  const keys = [...entries.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let size = 24;
  for (const k of keys) size += 12 + entries.get(k).length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x42, 0x44, 0x4b, 0x43]);  // BDKC
  dv.setUint32(4, 1, true);
  for (let i = 0; i < 16; i++) out[8 + i] = CACHE_TAG.charCodeAt(i);
  let at = 24;
  for (const k of keys) {
    const d = entries.get(k);
    dv.setBigUint64(at, k, true);
    dv.setUint32(at + 8, d.length, true);
    out.set(d, at + 12);
    at += 12 + d.length;
  }
  return out;
}
