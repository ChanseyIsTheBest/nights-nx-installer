// banjo-nx-installer: SPIRV-Cross (wasm/spirv_cross, bejeweled3-nx-installer's build of SPIRV-Cross 22b22f56) against
// banjo-nx's native out/deko3d_tools/spirv-cross-build output (out/deko3d_shaders/vk), tools/deko3d_shaders.py's arguments.
//   node test/spirv_cross_node.mjs <banjo-nx out/deko3d_shaders> [--count=N]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
const count = Number((process.argv.find((a) => a.startsWith('--count=')) || '--count=200').split('=')[1]);
const { default: createSpirvCrossModule } = await import(pathToFileURL(path.join(here, '..', 'wasm', 'spirv_cross.mjs')).href);
let out = '';
const m = await createSpirvCrossModule({ print: () => {}, printErr: () => {} });
const stems = fs.readdirSync(path.join(dir, 'spirv')).filter((f) => f.endsWith('.spv')).map((f) => f.slice(0, -4)).sort();
const pick = stems.filter((_, i) => i % Math.max(1, Math.floor(stems.length / count)) === 0);
let same = 0, diff = 0, ms = 0;
for (const stem of pick) {
  m.FS.writeFile('/in.spv', fs.readFileSync(path.join(dir, 'spirv', stem + '.spv')));
  const t = performance.now();
  m.callMain(['/in.spv', '--version', '460', '--vulkan-semantics', '--relax-nan-checks', '--output', '/out.glsl']);
  ms += performance.now() - t;
  out = m.FS.readFile('/out.glsl', { encoding: 'utf8' });
  // the native tool writes CRLF (Windows text mode); the next step (Python, text mode) reads LF either way
  if (out === fs.readFileSync(path.join(dir, 'vk', stem + '.vk.glsl'), 'utf8').split('\r\n').join('\n')) same++;
  else { diff++; if (diff <= 3) console.log(`differs: ${stem}`); }
}
console.log(`${pick.length} shaders: ${same} same, ${diff} different (${(ms / pick.length).toFixed(1)} ms each)`);
process.exit(diff ? 1 : 0);
