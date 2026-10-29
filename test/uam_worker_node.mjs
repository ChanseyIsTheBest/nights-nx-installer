// banjo-nx-installer: one uam (wasm/uam.mjs) on a Node worker thread, for test/full_node.mjs (the page's is
// uam_worker.js on a Web Worker).
import { parentPort } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadUam } from '../lib/uam.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { default: createUamModule } = await import(pathToFileURL(path.join(root, 'wasm', 'uam.mjs')).href);
const uam = await loadUam(createUamModule, { print: () => {}, printErr: () => {} });
parentPort.on('message', ({ id, stage, text }) => {
  const r = uam.compile(stage, text);
  if (r.error !== undefined) parentPort.postMessage({ id, error: r.error });
  else parentPort.postMessage({ id, dksh: r.dksh }, [r.dksh.buffer]);
});
parentPort.postMessage({ ready: true });
