// banjo-nx-installer: the whole chain on a sample of the dumped containers against the native glsl_opt_any.
//   node test/chain_node.mjs <banjo-nx root> [--count=N]
// Translator -> (pixel: early alpha) -> DXC -> SPIRV-Cross -> deko3d_glsl -> deko3d_glsl_opt; a shader whose GLSL is
// not the native one's is compiled by uam (its generic text) to see that it still compiles.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPython } from '../lib/py.js';
import { hlslToGlsl } from '../lib/chain.js';
import { loadUam } from '../lib/uam.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const banjo = process.argv[2];
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=60').split('=')[1]);
const imp = async (f) => (await import(pathToFileURL(path.join(root, 'wasm', f)).href)).default;
// A fresh options object per module: Emscripten makes the object it is given the module itself.
const quiet = () => ({ print: () => {}, printErr: () => {} });
const trLog = [];
const tr = await (await imp('renut_hlsl.mjs'))({ print: (s) => trLog.push(s), printErr: (s) => trLog.push(s) });
const dxc = await (await imp('dxc_web.mjs'))(quiet());
const spirvCross = await (await imp('spirv_cross.mjs'))(quiet());
const uam = await loadUam(await imp('uam.mjs'));
const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const py = await loadPython(loadPyodide, path.join(root, 'vendor', 'pyodide') + path.sep,
                            async (n) => fs.readFileSync(path.join(root, 'py', n), 'utf8'));
await py.pyodide.loadPackage('numpy', { messageCallback: () => {} });
py.pyodide.runPython('import renut_early_alpha, io, contextlib');

const dumpDir = path.join(banjo, 'out', 'renut_shader_dump');
const bins = fs.readdirSync(dumpDir).filter((f) => /^(vs|ps)_[0-9a-fA-F]{16}\.bin$/.test(f)).sort();
const pick = bins.filter((_, i) => i % Math.max(1, Math.floor(bins.length / count)) === 0);
tr.FS.mkdir('/in');
for (const f of pick) tr.FS.writeFile('/in/' + f, fs.readFileSync(path.join(dumpDir, f)));
tr.FS.writeFile('/c.h', fs.readFileSync(path.join(banjo, 'app', 'thirdparty', 'reblue-XenosRecomp', 'XenosRecomp', 'shader_common.h')));
const trc = tr.callMain(['/in', '/out', '/c.h']);
console.log(`translator: ${trc}: ${trLog.slice(-3).join(' | ')}`);
const names = tr.FS.readdir('/out').filter((f) => f.endsWith('.hlsl')).map((f) => f.slice(0, -5)).sort();
py.pyodide.FS.mkdirTree('/ea/hlsl');
for (const n of names.filter((n) => n.startsWith('ps_'))) py.pyodide.FS.writeFile(`/ea/hlsl/${n}.hlsl`, tr.FS.readFile(`/out/${n}.hlsl`));
py.pyodide.runPython(`
import sys
sys.argv = ['renut_early_alpha.py', '/ea/hlsl']
with contextlib.redirect_stdout(io.StringIO()):
    renut_early_alpha.main()
`);
let same = 0, differ = 0, compiles = 0, fails = 0, errors = 0;
const t0 = performance.now();
for (const n of names) {
  const hlsl = n.startsWith('ps_') ? py.pyodide.FS.readFile(`/ea/hlsl/${n}.hlsl`, { encoding: 'utf8' })
                                   : tr.FS.readFile(`/out/${n}.hlsl`, { encoding: 'utf8' });
  let glsl;
  try { glsl = hlslToGlsl(n, hlsl, { dxc, spirvCross }, py); } catch (e) { errors++; console.log(`${n}: ${e.message}`); continue; }
  const nativePath = path.join(banjo, 'out', 'deko3d_shaders', 'glsl_opt_any', n.slice(0, 3) + n.slice(3).toUpperCase() + '.glsl');
  if (fs.existsSync(nativePath) && glsl === fs.readFileSync(nativePath, 'utf8')) { same++; continue; }
  differ++;
  const r = uam.compile(n.startsWith('ps_') ? 4 : 0, glsl);
  if (r.error) { fails++; if (fails <= 3) console.log(`${n}: uam: ${r.error.slice(0, 200)}`); } else compiles++;
  if (differ <= 3) { console.log(`differs: ${n}`); fs.writeFileSync(path.join(root, 'test', `out_diff_${differ}_${n}.glsl`), glsl); }
}
console.log(`${names.length} shaders (${((performance.now() - t0) / names.length).toFixed(0)} ms each after translation): ` +
            `${same} the native GLSL, ${differ} different (${compiles} compile with uam, ${fails} do not), ${errors} chain errors`);
