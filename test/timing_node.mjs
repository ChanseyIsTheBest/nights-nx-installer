// banjo-nx-installer: where the time of lib/build.js's GLSL step goes, on a sample of the native dump.
//   node test/timing_node.mjs <banjo-nx root> [--count=N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPython } from '../lib/py.js';
import { DXC_PREAMBLE, undoInvertY } from '../lib/chain.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const banjo = process.argv[2];
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=40').split('=')[1]);
const imp = async (f) => (await import(pathToFileURL(path.join(root, 'wasm', f)).href)).default;
const quiet = () => ({ print: () => {}, printErr: () => {} });
const tr = await (await imp('renut_hlsl.mjs'))(quiet());
const dxc = await (await imp('dxc_web.mjs'))(quiet());
const spirvCross = await (await imp('spirv_cross.mjs'))(quiet());
const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const py = await loadPython(loadPyodide, path.join(root, 'vendor', 'pyodide') + path.sep,
                            async (n) => fs.readFileSync(path.join(root, 'py', n), 'utf8'));
const dumpDir = path.join(banjo, 'out', 'renut_shader_dump');
const bins = fs.readdirSync(dumpDir).filter((f) => /^(vs|ps)_[0-9a-fA-F]{16}\.bin$/.test(f)).sort();
const pick = bins.filter((_, i) => i % Math.max(1, Math.floor(bins.length / count)) === 0);
const t = { translate: 0, earlyAlpha: 0, dxc: 0, spirvCross: 0, convert: 0, optimise: 0 };
const time = (k, f) => { const a = performance.now(); const r = f(); t[k] += performance.now() - a; return r; };
tr.FS.mkdir('/in');
pick.forEach((f) => tr.FS.writeFile('/in/' + f, fs.readFileSync(path.join(dumpDir, f))));
tr.FS.writeFile('/c.h', fs.readFileSync(path.join(banjo, 'app', 'thirdparty', 'reblue-XenosRecomp', 'XenosRecomp', 'shader_common.h')));
time('translate', () => tr.callMain(['/in', '/out', '/c.h']));
const names = tr.FS.readdir('/out').filter((f) => f.endsWith('.hlsl')).map((f) => f.slice(0, -5)).sort();
const hlsl = new Map(names.map((n) => [n, tr.FS.readFile(`/out/${n}.hlsl`, { encoding: 'utf8' })]));
const pixel = names.filter((n) => n.startsWith('ps_'));
for (const [n, text] of time('earlyAlpha', () => py.earlyAlpha(pixel.map((n) => [n, hlsl.get(n)])))) hlsl.set(n, text);
for (const n of names) {
  const vertex = n.startsWith('vs_');
  dxc.FS.writeFile('/s.hlsl', DXC_PREAMBLE + hlsl.get(n));
  time('dxc', () => dxc.ccall('compile', 'number', ['string', 'string', 'number'], ['/s.hlsl', '/s.spv', vertex ? 1 : 0]));
  spirvCross.FS.writeFile('/s.spv', dxc.FS.readFile('/s.spv'));
  time('spirvCross', () => spirvCross.callMain(['/s.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks', '--output', '/s.vk.glsl']));
  let vk = spirvCross.FS.readFile('/s.vk.glsl', { encoding: 'utf8' });
  if (vertex) vk = undoInvertY(vk);
  const stage = vertex ? 'vert' : 'frag';
  const g = time('convert', () => py.convert(vk, stage));
  time('optimise', () => py.optimise(g, stage, n.slice(3)));
}
const total = Object.values(t).reduce((a, b) => a + b, 0);
console.log(`${names.length} shaders (${pixel.length} pixel): ${(total / names.length).toFixed(0)} ms each; ` +
            Object.entries(t).map(([k, v]) => `${k} ${(v / names.length).toFixed(0)} ms`).join(', '));
