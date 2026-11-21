// nights-nx-installer (2026-11-22): a movie's H.265 copy made on a PC as the page makes it (lib/movies.js: the pictures
// the game's decoder shows, from wasm/vc1; lib/asf.js: the remux), with ffmpeg's libx265 in place of the browser's
// encoder (Node has no WebCodecs). For test runs of the port. Node 24, from this folder:
//   node test/hevc_node.mjs <movie.wmv> <out.wmv> [--fraction 0.35] [--gop 120] [--ffmpeg C:/ffmpeg/ffmpeg.exe]
//        [--yuv pictures.yuv]   (also the pictures given to the encoder, raw I420, to compare)
// Game data: never commit or share what it reads or writes.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Asf } from '../lib/asf.js';
import { isSkipped, showPictures } from '../lib/movies.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const fraction = Number(flag('--fraction', '0.35')), gop = Number(flag('--gop', '120'));
const FFMPEG = flag('--ffmpeg', 'C:/ffmpeg/ffmpeg.exe'), yuvOut = flag('--yuv', null);
const preset = flag('--preset', 'medium');  // libx265's speed preset (the page uses the browser's encoder instead)
const [input, output] = args;
if (!input || !output) {
  console.error('usage: node test/hevc_node.mjs <movie.wmv> <out.wmv> [--fraction f] [--gop n] [--yuv file]');
  process.exit(2);
}

const asf = new Asf(new Uint8Array(fs.readFileSync(input)));
const objs = asf.mediaObjects();
const video = objs.filter((o) => o.stream === asf.videoStream);
const span = (video[video.length - 1].time - video[0].time) / 1000;
const seconds = span * video.length / (video.length - 1);
const fps = video.length / seconds;
const kbps = Math.max(200, video.reduce((n, o) => n + o.data.length, 0) * 8 / seconds / 1000 * fraction);

const { default: createVc1Module } = await import(pathToFileURL(path.join(root, 'wasm', 'vc1.mjs')).href);
const vc1 = await createVc1Module();
const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p',
  '-s', `${asf.width}x${asf.height}`, '-r', String(Math.round(fps)), '-i', '-', '-c:v', 'libx265', '-preset', preset,
  '-b:v', `${Math.round(kbps)}k`,
  '-x265-params', `bframes=0:keyint=${gop}:min-keyint=${gop}:scenecut=0:aud=1:repeat-headers=1:log-level=error`,
  '-f', 'hevc', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
const out = [];
ff.stdout.on('data', (d) => out.push(d));
const done = new Promise((resolve) => ff.on('close', resolve));
const yuv = yuvOut ? fs.openSync(yuvOut, 'w') : null;
const encoded = [];
for (const [i, i420] of showPictures(asf, video, vc1)) {
  const copy = Buffer.from(i420);
  if (yuv !== null) fs.writeSync(yuv, copy);
  if (!ff.stdin.write(copy)) await new Promise((r) => ff.stdin.once('drain', r));
  encoded.push(i);
}
ff.stdin.end();
if (yuv !== null) fs.closeSync(yuv);
const code = await done;
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
const stream = Buffer.concat(out);

// The access units: each starts with an access unit delimiter (00 00 00 01 46 01 ...: NAL type 35).
const starts = [];
for (let i = 0; i + 5 < stream.length; ++i) {
  if (stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 0 && stream[i + 3] === 1 && ((stream[i + 4] >> 1) & 0x3f) === 35) starts.push(i);
}
if (starts.length !== encoded.length) throw new Error(`${starts.length} H.265 access units for ${encoded.length} pictures`);
encoded.forEach((frameIndex, k) => {
  const o = video[frameIndex];
  o.data = new Uint8Array(stream.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : stream.length));
  o.key = k % gop === 0;
});
for (const o of video) if (isSkipped(o.data)) o.key = false;
const bytes = asf.write(objs);
fs.writeFileSync(output, bytes);
console.log(`${path.basename(input)}: ${asf.width}x${asf.height}, ${video.length} frames (${video.length - encoded.length} ` +
            `skipped), ${fps.toFixed(2)} fps; ${(fs.statSync(input).size / 1048576).toFixed(1)} MB -> ` +
            `${(bytes.length / 1048576).toFixed(1)} MB (H.265 at ${Math.round(kbps)} kbit/s)`);
