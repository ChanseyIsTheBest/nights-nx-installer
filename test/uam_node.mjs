// banjo-nx-installer: the page's uam (wasm/uam.wasm) against the console's DKSH cache made by the PC tool.
//   node test/uam_node.mjs <glsl dir> <release/variants.txt> <deko3d_shaders_N.bin> [--count N] [--all]
// For each variant chosen (evenly spaced over the list, or all): its text from the shader's GLSL, its key (must be in
// the cache), the wasm compile, and the bytes compared with the cache's.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseVariants, variantText, fnv1a64, readCache } from '../lib/variants.js';
import { loadUam } from '../lib/uam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const [glslDir, variantsFile, cacheFile] = process.argv.slice(2);
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=200').split('=')[1]);
const all = process.argv.includes('--all');
const { default: createUamModule } = await import(pathToFileURL(path.join(here, '..', 'wasm', 'uam.mjs')).href);
const uam = await loadUam(createUamModule);
const variants = parseVariants(fs.readFileSync(variantsFile, 'utf8'));
const cache = readCache(new Uint8Array(fs.readFileSync(cacheFile)));
const pick = all ? variants : variants.filter((_, i) => i % Math.max(1, Math.floor(variants.length / count)) === 0);
const enc = new TextEncoder();
const glslMemo = new Map();
let same = 0, differ = 0, missing = 0, failed = 0, ms = 0;
for (const v of pick) {
  let glsl = glslMemo.get(v.stem);
  if (glsl === undefined) {
    glsl = fs.readFileSync(path.join(glslDir, v.stem + '.glsl'), 'utf8');
    glslMemo.set(v.stem, glsl);
  }
  const text = variantText(glsl, v.pairs);
  const key = fnv1a64(enc.encode(text));
  const want = cache.get(key);
  if (!want) { missing++; continue; }
  const t0 = performance.now();
  const r = uam.compile(v.stage, text);
  ms += performance.now() - t0;
  if (r.error) { failed++; if (failed <= 3) console.log(`failed ${v.stem}: ${r.error.slice(0, 200)}`); continue; }
  if (r.dksh.length === want.length && r.dksh.every((b, i) => b === want[i])) same++;
  else { differ++; if (differ <= 5) console.log(`DIFFERENT ${v.stem} ${v.pairs.map((p) => p.join('=')).join(',')}: ${r.dksh.length} vs ${want.length} bytes`); }
}
console.log(`${pick.length} variants: ${same} byte for byte the cache's, ${differ} different, ${failed} failed, ${missing} not in the cache; ` +
            `${(ms / Math.max(1, same + differ)).toFixed(1)} ms a compile on one thread`);
process.exit(differ || failed ? 1 : 0);
