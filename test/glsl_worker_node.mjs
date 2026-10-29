// banjo-nx-installer: one GLSL worker (lib/glsl_job.js) on a Node worker thread, for test/full_node.mjs (the page's
// is glsl_worker.js on a Web Worker).
import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { glslJob } from '../lib/glsl_job.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = async (f) => (await import(pathToFileURL(path.join(root, 'wasm', f)).href)).default;
const { loadPyodide } = await import(pathToFileURL(path.join(root, 'vendor', 'pyodide', 'pyodide.mjs')).href);
const handle = await glslJob({
  createDxc: await imp('dxc_web.mjs'),
  createSpirvCross: await imp('spirv_cross.mjs'),
  loadPyodide,
  pyodideIndex: path.join(root, 'vendor', 'pyodide') + path.sep,
  readPy: async (n) => fs.readFileSync(path.join(root, 'py', n), 'utf8'),
});
parentPort.on('message', (data) => {
  const reply = handle(data);
  parentPort.postMessage(reply, reply.glsl ? [reply.glsl.buffer] : []);
});
parentPort.postMessage({ ready: true });
