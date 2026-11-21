// nights-nx-installer (2026-11-22, the user: "rencode video and audio to opus and h265"; culdcept-nx-installer's
// lib/movies.js of 2026-11-20, credit it): one of NiGHTS's movies (afs/*.wmv: ASF, VC-1 advanced profile with B
// pictures, WMA Pro audio) as an H.265 copy, as the port plays it (nights-nx's app/src/nights_wmv_ffmpeg.cpp: a movie
// whose first frame is H.265 goes to the Switch's video hardware, NVDEC, through nxvideo):
//   1. the ASF file read as its frames (lib/asf.js);
//   2. the frames decoded in order (wasm/vc1: FFmpeg's VC-1 decoder) and, for each, the picture the game's own decoder
//      shows for it: the newest picture the decoder has given, the first frame's own picture at the movie's start, the
//      last one again when a frame gives none, and nothing for a skipped frame (a payload of one byte: the game's decoder
//      answers with no picture and the player asks for none). nights-nx checked this rule on the PC against the game's
//      decoder, picture for picture;
//   3. each of those pictures encoded by the browser's H.265 encoder (WebCodecs, the computer's video hardware) at
//      `fraction` of the movie's own video bitrate, a keyframe every `gop` pictures, no reordering (one picture out per
//      picture in), so the port's H.265 decoder shows at each frame exactly what the game's decoder showed;
//   4. the file written again with the H.265 pictures in place of the VC-1 frames (lib/asf.js), each led by an access
//      unit delimiter, so the port knows the movie by its first bytes; the skipped frames stay as they are.
// Returns { bytes: null, why } (the WMV is kept as it is) when the browser has no H.265 encoder or the encoder does not
// give one picture per picture in order.
import { Asf } from './asf.js';

const AUD = new Uint8Array([0, 0, 0, 1, 0x46, 0x01, 0x50]);  // an H.265 access unit delimiter (any picture type)

export function hevcConfig(width, height, kbps, fps) {
  return {
    codec: 'hvc1.1.6.L120.B0',  // Main profile, level 4: 1280x720 at 60 fps
    width, height,
    bitrate: Math.round(kbps * 1000),
    bitrateMode: 'variable',
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    hevc: { format: 'annexb' },
  };
}

// Whether this browser can encode the movies' H.265 (WebCodecs with an H.265 encoder).
export async function canEncodeHevc() {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return !!(await VideoEncoder.isConfigSupported(hevcConfig(1280, 720, 1500, 60))).supported;
  } catch {
    return false;
  }
}

// A skipped frame: the game's decoder gives no picture for it (nights-nx's nights_wmv_ffmpeg.cpp).
export const isSkipped = (data) => data.length <= 1;

// The pictures the game's decoder shows for `video` (the ASF's video objects, in order): yields [i, i420] for each
// frame that shows one, in order, with the decoder's I420 bytes (valid until the next step). vc1: wasm/vc1.mjs.
export function* showPictures(asf, video, vc1) {
  const seq = vc1._vc1_malloc(Math.max(1, asf.codecData.length));
  vc1.HEAPU8.set(asf.codecData, seq);
  const opened = vc1._vc1_open(seq, asf.codecData.length, asf.width, asf.height);
  vc1._vc1_free(seq);
  if (opened < 0) throw new Error('the VC-1 decoder did not open');
  const frameBytes = asf.width * asf.height * 3 / 2;
  let input = vc1._vc1_malloc(1 << 20), inputSize = 1 << 20;
  let shown = false;  // a picture to show again
  try {
    for (let i = 0; i < video.length; ++i) {
      const o = video[i];
      if (o.data.length > inputSize) {
        vc1._vc1_free(input);
        inputSize = o.data.length;
        input = vc1._vc1_malloc(inputSize);
      }
      vc1.HEAPU8.set(o.data, input);
      const given = vc1._vc1_decode(input, o.data.length);
      if (given < 0) throw new Error(`frame ${i} could not be decoded (${given})`);
      if (given === 0 && i === 0 && vc1._vc1_first(input, o.data.length) === 1) shown = true;
      if (given > 0) shown = true;
      if (isSkipped(o.data)) continue;
      if (!shown) throw new Error(`frame ${i} has no picture to show`);
      const p = vc1._vc1_picture();
      yield [i, vc1.HEAPU8.subarray(p, p + frameBytes)];
    }
  } finally {
    vc1._vc1_free(input);
    vc1._vc1_close();
  }
}

// bytes: the .wmv file; vc1: an instance of wasm/vc1.mjs. -> { bytes, frames, kbps } or { bytes: null, why }.
export async function reencodeMovie(bytes, vc1, { fraction = 0.35, gop = 120, minKbps = 200 } = {}) {
  const asf = new Asf(bytes);
  const objs = asf.mediaObjects();
  const video = objs.filter((o) => o.stream === asf.videoStream);
  if (video.length < 2) return { bytes: null, why: 'no video frames' };
  const span = (video[video.length - 1].time - video[0].time) / 1000;
  const seconds = span * video.length / (video.length - 1);
  const fps = video.length / seconds;
  const sourceKbps = video.reduce((n, o) => n + o.data.length, 0) * 8 / seconds / 1000;
  const kbps = Math.max(minKbps, sourceKbps * fraction);
  const config = hevcConfig(asf.width, asf.height, kbps, Math.round(fps));
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) return { bytes: null, why: 'this browser has no H.265 encoder' };

  const chunks = [];
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp });
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  const encoded = [];  // the frames given an H.265 picture, in order
  try {
    for (const [i, i420] of showPictures(asf, video, vc1)) {
      const o = video[i];
      const frame = new VideoFrame(i420.slice(), {
        format: 'I420', codedWidth: asf.width, codedHeight: asf.height,
        timestamp: Math.round(o.time * 1000), duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: encoded.length % gop === 0 });
      frame.close();
      encoded.push(i);
      while (encoder.encodeQueueSize > 8 && !failure) await new Promise((r) => setTimeout(r, 1));
      if (failure) break;
    }
    await encoder.flush();
  } catch (e) {
    failure = failure || e;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  if (failure) return { bytes: null, why: `the encoder failed: ${failure.message || failure}` };
  if (chunks.length !== encoded.length) return { bytes: null, why: `${chunks.length} H.265 frames for ${encoded.length}` };
  for (let i = 1; i < chunks.length; ++i)
    if (chunks[i].timestamp <= chunks[i - 1].timestamp) return { bytes: null, why: 'the encoder reordered frames' };
  if (!chunks[0].key) return { bytes: null, why: 'the first H.265 frame is not a keyframe' };
  if (encoded[0] !== 0) return { bytes: null, why: 'the first frame is a skipped one' };

  // An access unit delimiter first, unless the encoder put one there (Chrome's does): one per access unit.
  const startsWithAud = (d) => {
    const i = d[2] === 1 ? 3 : d[3] === 1 ? 4 : -1;
    return d[0] === 0 && d[1] === 0 && i > 0 && ((d[i] >> 1) & 0x3f) === 35;
  };
  encoded.forEach((frameIndex, k) => {
    const o = video[frameIndex];
    const c = chunks[k].data;
    if (startsWithAud(c)) {
      o.data = c;
    } else {
      o.data = new Uint8Array(AUD.length + c.length);
      o.data.set(AUD);
      o.data.set(c, AUD.length);
    }
    o.key = chunks[k].key;
  });
  // a skipped frame keeps its byte and is no keyframe
  for (const o of video) if (isSkipped(o.data)) o.key = false;
  return { bytes: asf.write(objs), frames: video.length, pictures: encoded.length, kbps: Math.round(kbps), why: null };
}
