// sa2-nx-ult-installer (2026-11-21): one game file of ADX streams re-encoded to Opus on a worker of its own (lib/audio.js:
// SA2's ADX decode and the resampler in JavaScript, the browser's Opus encoder, the .adxo written). culdcept-nx-installer's
// worker with its XMA decoder left out. Answers { id, bytes, bitrates } with { id, bytes, streams, why }: bytes null when
// the file is kept as it is (why says why).
import { canEncodeOpus, reencodeAudio } from './lib/audio.js';

const opus = await canEncodeOpus();

// One file at a time (an archive's streams one after another inside it).
let chain = Promise.resolve();
self.onmessage = ({ data }) => { chain = chain.then(() => job(data)); };
async function job(data) {
  const { id, bytes, bitrates } = data;
  let r;
  try {
    r = opus ? await reencodeAudio(bytes, bitrates) : { bytes: null, why: 'this browser has no Opus encoder' };
  } catch (e) {
    r = { bytes: null, why: e.message || String(e) };
  }
  self.postMessage({ id, bytes: r.bytes, streams: r.streams, why: r.why }, r.bytes ? [r.bytes.buffer] : []);
}
self.postMessage({ ready: true, opus });
