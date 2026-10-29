// banjo-nx-installer: lib/variants.js's fnv1a64 (32-bit halves) against the BigInt definition, on random bytes and on
// variant texts; and the keys of a sample of release/variants.txt against the console's cache.
//   node test/fnv_node.mjs [<glsl dir> <deko3d_shaders_N.bin>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1a64, fnv1a64Reference, parseVariants, readCache, variantText } from '../lib/variants.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
for (let n = 0; n < 2000; n++) {
  const b = new Uint8Array(Math.floor(Math.random() * 300));
  for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  if (fnv1a64(b) !== fnv1a64Reference(b)) bad++;
}
console.log(`random: ${bad} of 2000 differ`);
const [glslDir, cacheFile] = process.argv.slice(2);
if (glslDir) {
  const cache = readCache(new Uint8Array(fs.readFileSync(cacheFile)));
  const variants = parseVariants(fs.readFileSync(path.join(root, 'release', 'variants.txt'), 'utf8'));
  const enc = new TextEncoder();
  let found = 0, n = 0, t = 0;
  for (const v of variants.filter((_, i) => i % 50 === 0)) {
    const p = path.join(glslDir, v.stem + '.glsl');
    if (!fs.existsSync(p)) continue;
    const bytes = enc.encode(variantText(fs.readFileSync(p, 'utf8'), v.pairs));
    const a = performance.now();
    const key = fnv1a64(bytes);
    t += performance.now() - a;
    n++;
    if (key !== fnv1a64Reference(bytes)) bad++;
    if (cache.has(key)) found++;
  }
  console.log(`${n} variants: ${found} keys in the cache, ${bad} differ from the definition, ${(t / n).toFixed(2)} ms a key`);
}
process.exit(bad ? 1 : 0);
