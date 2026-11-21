// nights-nx-installer (2026-11-22): one file packed as the page packs it (lib/lz4b.js with wasm/lz4 or wasm/zxc, here in
// this thread), as OUT (normally NAME.lz4b). For an H.265 movie copy (test/hevc_node.mjs), packed as ZXC as the page
// packs those. Node 24, from this folder:
//   node test/pack_one_node.mjs <file> <out.lz4b> [zxc|lz4]
// Game data: never commit or share what it reads or writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CODECS, pack } from '../lib/lz4b.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async (f) => (await import(pathToFileURL(path.join(root, 'wasm', f)).href)).default;
const [input, output, codec = 'zxc'] = process.argv.slice(2);
const [lz4, zxc] = await Promise.all([(await load('lz4.mjs'))(), (await load('zxc.mjs'))()]);

// pack_worker.js's compression, in this thread
async function compress(bytes, which) {
  const { level, block } = CODECS[which];
  let n, m, src, dst;
  if (which === 'zxc') {
    m = zxc;
    const bound = zxc._zxc_bound(Math.max(bytes.length, block));
    src = zxc._zxc_malloc(bytes.length);
    dst = zxc._zxc_malloc(bound);
    zxc.HEAPU8.set(bytes, src);
    n = zxc._zxc_pack(src, bytes.length, dst, zxc._zxc_bound(bytes.length), level, block);
  } else {
    m = lz4;
    src = lz4._lz4_malloc(bytes.length);
    dst = lz4._lz4_malloc(bytes.length);
    lz4.HEAPU8.set(bytes, src);
    n = lz4._lz4_compress(src, bytes.length, dst, bytes.length - 1, level);
  }
  const out = n > 0 ? m.HEAPU8.slice(dst, dst + n) : bytes.slice();
  m[`_${which}_free`](src);
  m[`_${which}_free`](dst);
  return out;
}

const bytes = new Uint8Array(fs.readFileSync(input));
const file = { size: bytes.length, read: async (o, n) => bytes.subarray(o, o + n) };
const fd = fs.openSync(output, 'w');
let size = 0;
for await (const chunk of pack(file, compress, { codec, inFlight: 8 })) {
  fs.writeSync(fd, chunk);
  size += chunk.length;
}
fs.closeSync(fd);
console.log(`${path.basename(input)}: ${bytes.length} -> ${size} bytes (${codec.toUpperCase()}, ${(size / bytes.length * 100).toFixed(1)} %)`);
