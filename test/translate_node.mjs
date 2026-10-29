// banjo-nx-installer: the translator (wasm/renut_hlsl) and the early alpha pass (py/renut_early_alpha.py in Pyodide)
// against the native build's rewritten pixel shaders (app/out/pc-me/renut_gpu/early_alpha_hlsl: its first run's dumps
// after tools/renut_early_alpha.py).
//   node test/translate_node.mjs <shader dump folder> <early_alpha_hlsl folder> <shader_common.h> [--count=N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const [dumpDir, nativeDir, commonPath] = process.argv.slice(2);
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=100').split('=')[1]);
const { default: createRenutHlslModule } = await import(pathToFileURL(path.join(root, 'wasm', 'renut_hlsl.mjs')).href);
const log = [];
const tr = await createRenutHlslModule({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
const bins = fs.readdirSync(dumpDir).filter((f) => /^ps_[0-9a-fA-F]{16}\.bin$/.test(f)).sort();
const pick = bins.filter((_, i) => i % Math.max(1, Math.floor(bins.length / count)) === 0);
tr.FS.mkdir('/in');
for (const f of pick) tr.FS.writeFile('/in/' + f, fs.readFileSync(path.join(dumpDir, f)));
tr.FS.writeFile('/shader_common.h', fs.readFileSync(commonPath));
let t = performance.now();
const rc = tr.callMain(['/in', '/out', '/shader_common.h']);
console.log(`translator: exit ${rc}, ${log.slice(-1)[0]}, ${((performance.now() - t) / pick.length).toFixed(1)} ms a shader`);

const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const pyodide = await loadPyodide({ indexURL: path.join(root, 'vendor', 'pyodide') + path.sep });
await pyodide.loadPackage('numpy', { messageCallback: () => {} });  // early_alpha.py's self-check
pyodide.FS.mkdirTree('/py');
for (const n of ['early_alpha.py', 'renut_early_alpha.py']) pyodide.FS.writeFile('/py/' + n, fs.readFileSync(path.join(root, 'py', n), 'utf8'));
pyodide.FS.mkdirTree('/ea/hlsl');
const outs = tr.FS.readdir('/out').filter((f) => f.endsWith('.hlsl'));
for (const f of outs) pyodide.FS.writeFile('/ea/hlsl/' + f, tr.FS.readFile('/out/' + f));
t = performance.now();
pyodide.runPython(`
import sys, io, contextlib
sys.path.insert(0, '/py')
sys.argv = ['renut_early_alpha.py', '/ea/hlsl']
import renut_early_alpha
with contextlib.redirect_stdout(io.StringIO()):
    renut_early_alpha.main()
`);
console.log(`early alpha: ${((performance.now() - t) / outs.length).toFixed(1)} ms a shader`);
const native = new Map(fs.readdirSync(nativeDir).map((f) => [f.toLowerCase(), f]));
let same = 0, diff = 0, missing = 0;
for (const f of outs) {
  const n = native.get(f.toLowerCase());
  if (!n) { missing++; continue; }
  const mine = pyodide.FS.readFile('/ea/hlsl/' + f, { encoding: 'utf8' });
  // the native dump's first line names the hash as the translator printed it (the same digits)
  if (mine.toLowerCase() === fs.readFileSync(path.join(nativeDir, n), 'utf8').toLowerCase()) same++;
  else { diff++; if (diff <= 3) console.log(`differs: ${f}`); }
}
console.log(`${outs.length} pixel shaders: ${same} the native rewritten HLSL, ${diff} different, ${missing} without a native file`);
process.exit(diff ? 1 : 0);
