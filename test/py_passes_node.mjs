// banjo-nx-installer: the Python steps in Pyodide against the native chain's outputs.
//   node test/py_passes_node.mjs <banjo-nx out/deko3d_shaders> [--count=N] [--all]
// vk/<stem>.vk.glsl --convert--> glsl/<stem>.glsl --optimise--> glsl_opt_any/<stem>.glsl, each compared byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPython } from '../lib/py.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const dir = process.argv[2];
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=200').split('=')[1]);
const all = process.argv.includes('--all');
const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const t0 = performance.now();
const py = await loadPython(loadPyodide, path.join(root, 'vendor', 'pyodide') + path.sep,
                            async (name) => fs.readFileSync(path.join(root, 'py', name), 'utf8'));
console.log(`Pyodide and the passes loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const stems = fs.readdirSync(path.join(dir, 'glsl')).filter((f) => /^(vs|ps)_[0-9A-F]{16}\.glsl$/.test(f))
  .map((f) => f.slice(0, -5)).sort();
const pick = all ? stems : stems.filter((_, i) => i % Math.max(1, Math.floor(stems.length / count)) === 0);
let convSame = 0, convDiff = 0, optSame = 0, optDiff = 0, msConv = 0, msOpt = 0;
for (const stem of pick) {
  const stage = stem.startsWith('ps_') ? 'frag' : 'vert';
  const vk = fs.readFileSync(path.join(dir, 'vk', stem + '.vk.glsl'), 'utf8');
  let t = performance.now();
  const glsl = py.convert(vk, stage);
  msConv += performance.now() - t;
  if (glsl === fs.readFileSync(path.join(dir, 'glsl', stem + '.glsl'), 'utf8')) convSame++;
  else { convDiff++; if (convDiff <= 3) console.log(`convert differs: ${stem}`); }
  t = performance.now();
  const opt = py.optimise(glsl, stage, stem.slice(3));
  msOpt += performance.now() - t;
  if (opt === fs.readFileSync(path.join(dir, 'glsl_opt_any', stem + '.glsl'), 'utf8')) optSame++;
  else { optDiff++; if (optDiff <= 3) console.log(`optimise differs: ${stem}`); }
}
console.log(`${pick.length} shaders: convert ${convSame} same / ${convDiff} different (${(msConv / pick.length).toFixed(1)} ms each), ` +
            `optimise ${optSame} same / ${optDiff} different (${(msOpt / pick.length).toFixed(1)} ms each)`);
process.exit(convDiff || optDiff ? 1 : 0);
