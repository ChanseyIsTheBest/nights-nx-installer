// sa2-nx-ult-installer (2026-11-21, the user: "rencode ... all the audio to opus in a web installer like culdcept"): one
// of the game's files of CRI ADX streams (an .adx, an .afs archive of them) as NAME.adxo (lib/adx.js; the port's
// rex/filesystem/adx_opus.h), with the browser's Opus encoder (WebCodecs' AudioEncoder). culdcept-nx-installer's
// lib/audio.js (its XMA) is the model: the same encoder settings and pre-skip. Each stream: the samples SA2's decoder
// gives (lib/adx.js decodeAdx), resampled to 48 kHz (its zero-phase resampler, the port's filter), encoded in 20 ms
// packets. sa2-nx-ult's tools/adx_opus_pack.mjs makes the same files with FFmpeg's libopus on a PC.
// Returns { bytes: null, why } when the file stays as it is: no ADX stream the port plays, not smaller, or no Opus
// encoder in this browser.
import { buildAdxo, decodeAdx, findStreams, OPUS_RATE, resample } from './adx.js';

const OPUS_LOOKAHEAD = 312;  // libopus's at 48 kHz (2.5 ms + 4 ms): the pre-skip when the encoder gives no OpusHead

export function opusConfig(channels, bitrate) {
  return {
    codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate, bitrateMode: 'variable',
    opus: { frameDuration: 20000, complexity: 10, application: 'audio', format: 'opus' },
  };
}

export async function canEncodeOpus() {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    return !!(await AudioEncoder.isConfigSupported(opusConfig(2, 128000))).supported;
  } catch {
    return false;
  }
}

// One stream's planar 48 kHz samples (Float32Array per channel, 16-bit scale) as Opus: { packets, preSkip }.
async function encodeStream(planar, bitrate) {
  const channels = planar.length, frames = planar[0].length;
  const config = opusConfig(channels, bitrate);
  if (!(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('no Opus encoder for this stream');
  const packets = [];
  let preSkip = null, failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      packets.push(d);
      const desc = meta?.decoderConfig?.description;
      if (preSkip === null && desc) {
        const h = desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
        if (h.length >= 12 && new TextDecoder().decode(h.subarray(0, 8)) === 'OpusHead') preSkip = h[10] | (h[11] << 8);
      }
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  try {
    let time = 0;
    const feed = (from, count) => {
      const pcm = new Float32Array(count * channels);
      for (let i = 0; i < count; ++i)
        for (let c = 0; c < channels; ++c) {
          const k = from + i;
          pcm[i * channels + c] = k < frames ? planar[c][k] / 32768 : 0;
        }
      const data = new AudioData({ format: 'f32', sampleRate: 48000, numberOfFrames: count, numberOfChannels: channels,
                                   timestamp: Math.round(time * 1e6 / 48000), data: pcm });
      encoder.encode(data);
      data.close();
      time += count;
    };
    for (let f = 0; f < frames && !failure; f += 9600) {
      feed(f, Math.min(9600, frames - f));
      while (encoder.encodeQueueSize > 4 && !failure) await new Promise((r) => setTimeout(r, 1));
    }
    feed(frames, 1920);  // 40 ms of silence: the encoder's tail covers the last samples
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) throw new Error(`the Opus encoder failed: ${failure.message || failure}`);
  return { packets, preSkip: preSkip ?? OPUS_LOOKAHEAD, bitrate };
}

// bytes: the game file; bitrates: { stereo, mono } in bit/s.
export async function reencodeAudio(bytes, { stereo = 128000, mono = 40000 } = {}) {
  const streams = findStreams(bytes);
  if (!streams.length) return { bytes: null, why: 'no ADX stream the port plays from Opus' };
  const opus = [];
  try {
    for (const s of streams) {
      const pcm = decodeAdx(bytes, s);
      const up = pcm.map((ch) => resample(ch, s.rate, OPUS_RATE));
      opus.push(await encodeStream(up, s.channels === 2 ? stereo : mono));
    }
  } catch (e) {
    return { bytes: null, why: e.message || String(e) };
  }
  const out = buildAdxo(bytes, streams, opus);
  if (out.length >= bytes.length) return { bytes: null, why: `not smaller as Opus (${out.length} bytes)` };
  return { bytes: out, streams: streams.length, why: null };
}
