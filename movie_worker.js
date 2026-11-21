// nights-nx-installer (2026-11-22, culdcept-nx-installer's movie_worker.js of 2026-11-20, credit it): one movie
// re-encoded to H.265 on a worker of its own (lib/movies.js: the VC-1 decoder in WebAssembly, the browser's H.265
// encoder, the ASF remux). Answers { id, bytes, fraction, gop } with { id, bytes, frames, pictures, kbps, why }: bytes
// null when the movie is kept as it is (why says why).
import createVc1Module from './wasm/vc1.mjs';
import { canEncodeHevc, reencodeMovie } from './lib/movies.js';

const vc1 = await createVc1Module({ print: () => {}, printErr: () => {} });
const hevc = await canEncodeHevc();

// One movie at a time (culdcept-nx-installer, 2026-11-20): the pool posts a worker its next job while one runs, and this
// handler awaits the encoder, so a second message would reopen the one decoder under the first. The jobs wait in a chain.
let chain = Promise.resolve();
self.onmessage = ({ data }) => { chain = chain.then(() => job(data)); };
async function job(data) {
  const { id, bytes, fraction, gop } = data;
  let r;
  try {
    r = hevc ? await reencodeMovie(bytes, vc1, { fraction, gop }) : { bytes: null, why: 'this browser has no H.265 encoder' };
  } catch (e) {
    r = { bytes: null, why: e.message || String(e) };
  }
  self.postMessage({ id, bytes: r.bytes, frames: r.frames, pictures: r.pictures, kbps: r.kbps, why: r.why },
                   r.bytes ? [r.bytes.buffer] : []);
}
self.postMessage({ ready: true, version: vc1._vc1_version(), hevc });
