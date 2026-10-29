// banjo-nx-installer: deko3d_glsl.bin version 2, the game shaders the page made from the player's files, which the
// distribution NRO reads beside itself (banjo-nx's app/src/renut_engine/gpu/banjo_renut_deko3d.cpp, OpenInstalled and
// InstalledShaderTable). Version 1 (banjo-nx's tools/deko3d_shader_package.py) without a dictionary, each shader's
// GLSL in one zstd frame of raw blocks (bejeweled3-nx-installer's lib/deko3d_package.js: any zstd decoder reads it and
// the page needs no compressor), plus the numbers of the NRO's shader table (shader_cache.h) for those shaders:
//
//   header (32 bytes): "BDKG", 2, count, 0 (no dictionary), table offset, data offset, info offset, info size
//   table: per shader (56 bytes, sorted by hash): u64 hash, u32 offset (from the data), compressed size, size, stage
//          (0 vertex, 4 pixel), 8 x u32 bool constant mask (ids 1000-1255 the GLSL defines)
//   info:  tag (16 bytes, INSTALLED_TAG), u32 vertex input count, u32 literal count, then per table entry (same order)
//          24 x u32: specConstantsMask, vertexFetchMemoryMask, textureFetchMask, memExportConstants[8],
//          floatConstants[8], vertexInputOffset, vertexInputCount, literalOffset, literalCount, shaderFlags; then the
//          vertex inputs (8 bytes: usage, usageIndex, fetchIndex, format, flags, strideDwords, u16 offsetDwords), then
//          the literals (20 bytes: u32 register, 4 x u32 value)
//   data:  the frames, each 8-byte aligned
//
// The NRO reads a package only with its own tag (kInstalledTag): the translator and GLSL chain of its release.
export const INSTALLED_TAG = 'renut7-bnxglsl1';

const ZSTD_MAGIC = 0xfd2fb528;
const MAX_RAW_BLOCK = 128 * 1024;

// One zstd frame holding `bytes` in raw blocks: single segment, 4-byte content size, no checksum, no dictionary id.
// (bejeweled3-nx-installer's zstdRawFrame)
export function zstdRawFrame(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / MAX_RAW_BLOCK));
  const out = new Uint8Array(4 + 1 + 4 + blocks * 3 + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, ZSTD_MAGIC, true);
  out[4] = (2 << 6) | (1 << 5);  // frame content size field of 4 bytes, single segment
  view.setUint32(5, bytes.length, true);
  let at = 9;
  for (let b = 0; b < blocks; ++b) {
    const start = b * MAX_RAW_BLOCK;
    const size = Math.min(MAX_RAW_BLOCK, bytes.length - start);
    const header = (b === blocks - 1 ? 1 : 0) | (size << 3);  // raw block
    out[at] = header & 0xff;
    out[at + 1] = (header >>> 8) & 0xff;
    out[at + 2] = (header >>> 16) & 0xff;
    at += 3;
    out.set(bytes.subarray(start, start + size), at);
    at += size;
  }
  return out;
}

// The bool specialization constants a shader's GLSL defines (deko3d_shader_package.py's mask).
export function boolMask(text) {
  const mask = new Uint32Array(8);
  for (const m of text.matchAll(/#define SPIRV_CROSS_CONSTANT_ID_(\d+) /g)) {
    const i = Number(m[1]);
    if (i >= 1000 && i < 1256) mask[(i - 1000) >> 5] |= 1 << ((i - 1000) & 31);
  }
  return mask;
}

// The translator's <stem>.txt (wasm/src/translator/renut_hlsl_frontend.cpp): the shader's numbers.
export function parseNumbers(text) {
  const n = { vertexInputs: [], literals: [] };
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (!f[0]) continue;
    const v = f.slice(1).map((x) => Number(x));
    switch (f[0]) {
      case 'hash': n.hash = BigInt(f[1]); break;
      case 'specConstantsMask': case 'vertexFetchMemoryMask': case 'textureFetchMask': case 'shaderFlags':
        n[f[0]] = v[0] >>> 0; break;
      case 'memExportConstants': case 'floatConstants': n[f[0]] = v.map((x) => x >>> 0); break;
      case 'vertexInput': n.vertexInputs.push(v); break;
      case 'literal': n.literals.push(v.map((x) => x >>> 0)); break;
      default: throw new Error(`translator numbers: unknown line "${line}"`);
    }
  }
  if (n.hash === undefined || n.memExportConstants?.length !== 8 || n.floatConstants?.length !== 8) {
    throw new Error('translator numbers: incomplete');
  }
  return n;
}

// shaders: [{ name: 'ps_558CF34EF8661CAE', glsl: '...', numbers: parseNumbers(...) }]. Returns the file (Uint8Array).
export function writeInstalledPackage(shaders) {
  const encoder = new TextEncoder();
  const entries = shaders.map(({ name, glsl, numbers }) => {
    const m = /^(vs|ps)_([0-9A-F]{16})$/.exec(name);
    if (!m) throw new Error(`package: bad shader name ${name}`);
    const hash = BigInt('0x' + m[2]);
    if (numbers.hash !== hash) throw new Error(`package: ${name} has the numbers of another shader`);
    const text = encoder.encode(glsl);
    return { hash, stage: m[1] === 'ps' ? 4 : 0, text, frame: zstdRawFrame(text), mask: boolMask(glsl), numbers };
  });
  entries.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  for (let i = 1; i < entries.length; ++i) {
    if (entries[i].hash === entries[i - 1].hash) throw new Error('package: a shader twice');
  }
  let inputCount = 0, literalCount = 0;
  for (const e of entries) {
    inputCount += e.numbers.vertexInputs.length;
    literalCount += e.numbers.literals.length;
  }
  const tableOffset = 32;
  const infoOffset = tableOffset + 56 * entries.length;
  const infoSize = 24 + 96 * entries.length + 8 * inputCount + 20 * literalCount;
  const dataOffset = infoOffset + infoSize + ((8 - ((infoOffset + infoSize) % 8)) % 8);
  let dataSize = 0;
  for (const e of entries) {
    e.offset = dataSize;
    dataSize += e.frame.length;
    dataSize += (8 - (dataSize % 8)) % 8;
  }
  const out = new Uint8Array(dataOffset + dataSize);
  const view = new DataView(out.buffer);
  out.set(encoder.encode('BDKG'), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, 0, true);
  view.setUint32(16, tableOffset, true);
  view.setUint32(20, dataOffset, true);
  view.setUint32(24, infoOffset, true);
  view.setUint32(28, infoSize, true);
  out.set(encoder.encode(INSTALLED_TAG), infoOffset);  // the rest of the 16 bytes stays 0
  view.setUint32(infoOffset + 16, inputCount, true);
  view.setUint32(infoOffset + 20, literalCount, true);
  let inputAt = infoOffset + 24 + 96 * entries.length;
  let literalAt = inputAt + 8 * inputCount;
  let inputIndex = 0, literalIndex = 0;
  entries.forEach((e, i) => {
    const at = tableOffset + 56 * i;
    view.setBigUint64(at, e.hash, true);
    view.setUint32(at + 8, e.offset, true);
    view.setUint32(at + 12, e.frame.length, true);
    view.setUint32(at + 16, e.text.length, true);
    view.setUint32(at + 20, e.stage, true);
    for (let k = 0; k < 8; ++k) view.setUint32(at + 24 + 4 * k, e.mask[k], true);
    out.set(e.frame, dataOffset + e.offset);
    const n = e.numbers;
    const words = [n.specConstantsMask, n.vertexFetchMemoryMask, n.textureFetchMask, ...n.memExportConstants,
                   ...n.floatConstants, inputIndex, n.vertexInputs.length, literalIndex, n.literals.length,
                   n.shaderFlags];
    const info = infoOffset + 24 + 96 * i;
    words.forEach((w, k) => view.setUint32(info + 4 * k, w >>> 0, true));
    for (const [usage, usageIndex, fetchIndex, format, flags, strideDwords, offsetDwords] of n.vertexInputs) {
      out.set([usage, usageIndex, fetchIndex, format, flags, strideDwords], inputAt);
      view.setUint16(inputAt + 6, offsetDwords, true);
      inputAt += 8;
    }
    for (const l of n.literals) {
      l.forEach((w, k) => view.setUint32(literalAt + 4 * k, w, true));
      literalAt += 20;
    }
    inputIndex += n.vertexInputs.length;
    literalIndex += n.literals.length;
  });
  return out;
}
