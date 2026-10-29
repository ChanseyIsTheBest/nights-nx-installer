// nights-nx-installer: the shader containers in NiGHTS's own files, by the rules of nights-nx's
// tools/renut_shader_dump.py (the dump its native build was made from):
//   - the executable's image (default.xex decrypted and unpacked by lib/xex.js): containers compiled into it are stored
//     whole (magic 0x102A11xx, low bit 1 = vertex shader), found as reNut's dump_shaders.py find_shader_headers finds
//     them;
//   - shader/xbox 360/*.wvu and *.wpu: whole containers (header + physical block) the game passes to Create*Shader as
//     they are.
// NiGHTS makes no shader at runtime: these 99 (82 in the image, 17 more in the files) are all of them. The base
// default.xex holds the same ones as the title update's image (checked 2026-10-29), so the update is not needed here.

const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

// The offsets of the containers in 'data' (find_shader_headers).
export function findShaderHeaders(data) {
  const found = [];
  for (let o = 0; o + 0x24 <= data.length; o += 4) {
    if (data[o] !== 0x10 || data[o + 1] !== 0x2a || data[o + 2] !== 0x11) continue;
    const virt = be32(data, o + 4), phys = be32(data, o + 8);
    const ct = be32(data, o + 0x10), dt = be32(data, o + 0x14), so = be32(data, o + 0x18);
    if (!(virt >= 0x24 && virt < 0x10000 && phys > 0 && phys < 0x100000 && o + virt <= data.length)) continue;
    if (ct >= virt || dt >= virt || !(so >= 0x24 && so < virt - 8)) continue;
    if (be32(data, o + so) + be32(data, o + so + 4) !== phys) continue;
    found.push(o);
  }
  return found;
}

// The containers compiled into the executable's image.
export function imageContainers(image) {
  const out = [];
  for (const o of findShaderHeaders(image)) {
    const size = be32(image, o + 4) + be32(image, o + 8);
    if (o + size <= image.length) out.push(image.slice(o, o + size));
  }
  return out;
}

// A stand-alone container file (shader/xbox 360/*.wvu, *.wpu), or null.
export function fileContainer(bytes) {
  if (bytes.length < 0x24 || bytes[0] !== 0x10 || bytes[1] !== 0x2a || bytes[2] !== 0x11) return null;
  const size = be32(bytes, 4) + be32(bytes, 8);
  return size <= bytes.length ? bytes.slice(0, size) : null;
}

export const isShaderFile = (path) => /^shader\/xbox 360\/[^/]+\.w[pv]u$/i.test(path);
