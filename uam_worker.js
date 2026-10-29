// banjo-nx-installer: one uam (wasm/uam.mjs, the console's shader compiler) on a Web Worker; worker.js runs several
// (lib/pool.js). Answers { id, dksh } or { id, error } to { id, stage, text }.
import createUamModule from './wasm/uam.mjs';
import { loadUam } from './lib/uam.js';

const uam = await loadUam(createUamModule, { print: () => {}, printErr: () => {} });
self.onmessage = ({ data: { id, stage, text } }) => {
  const r = uam.compile(stage, text);
  if (r.error !== undefined) postMessage({ id, error: r.error });
  else postMessage({ id, dksh: r.dksh }, [r.dksh.buffer]);
};
postMessage({ ready: true });
