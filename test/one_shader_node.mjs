// banjo-nx-installer: one shader of the native dump through the chain, its SPIRV-Cross text kept (debugging).
//   node test/one_shader_node.mjs <banjo-nx root> <vs|ps>_<HASH> <out folder>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DXC_PREAMBLE } from '../lib/chain.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [banjo, stem, out] = process.argv.slice(2);
const imp = async (f) => (await import(pathToFileURL(path.join(root, 'wasm', f)).href)).default;
const quiet = () => ({ print: () => {}, printErr: () => {} });
const tr = await (await imp('renut_hlsl.mjs'))(quiet());
const dxc = await (await imp('dxc_web.mjs'))(quiet());
const spirvCross = await (await imp('spirv_cross.mjs'))(quiet());
const dumpDir = path.join(banjo, 'out', 'renut_shader_dump');
const bin = fs.readdirSync(dumpDir).find((f) => f.toLowerCase() === stem.toLowerCase() + '.bin');
tr.FS.mkdir('/in');
tr.FS.writeFile('/in/' + bin, fs.readFileSync(path.join(dumpDir, bin)));
tr.FS.writeFile('/c.h', fs.readFileSync(path.join(banjo, 'app', 'thirdparty', 'reblue-XenosRecomp', 'XenosRecomp', 'shader_common.h')));
tr.callMain(['/in', '/out', '/c.h']);
const name = tr.FS.readdir('/out').find((f) => f.endsWith('.hlsl')).slice(0, -5);
const hlsl = tr.FS.readFile(`/out/${name}.hlsl`, { encoding: 'utf8' });
dxc.FS.writeFile('/s.hlsl', DXC_PREAMBLE + hlsl);
console.log('dxc', dxc.ccall('compile', 'number', ['string', 'string', 'number'], ['/s.hlsl', '/s.spv', name.startsWith('vs_') ? 1 : 0]));
spirvCross.FS.writeFile('/s.spv', dxc.FS.readFile('/s.spv'));
spirvCross.callMain(['/s.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks', '--output', '/s.vk.glsl']);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, name + '.vk.glsl'), spirvCross.FS.readFile('/s.vk.glsl', { encoding: 'utf8' }));
console.log(`${name}: ${path.join(out, name + '.vk.glsl')}`);

// Then the rest of the chain (lib/chain.js), against the native glsl_opt_any.
const { loadPython } = await import('../lib/py.js');
const { hlslToGlsl } = await import('../lib/chain.js');
const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const py = await loadPython(loadPyodide, path.join(root, 'vendor', 'pyodide') + path.sep,
                            async (n) => fs.readFileSync(path.join(root, 'py', n), 'utf8'));
const text = name.startsWith('ps_') ? py.earlyAlpha([[name, hlsl]])[0][1] : hlsl;
const glsl = hlslToGlsl(name, text, { dxc, spirvCross }, py);
fs.writeFileSync(path.join(out, name + '.glsl'), glsl);
const native = path.join(banjo, 'out', 'deko3d_shaders', 'glsl_opt_any', name + '.glsl');
console.log(`GLSL ${glsl.length} bytes: ${fs.existsSync(native) && fs.readFileSync(native, 'utf8') === glsl ? 'the native text' : 'NOT the native text'}`);
