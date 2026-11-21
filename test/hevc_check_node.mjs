// nights-nx-installer (2026-11-22): an H.265 copy of a movie (lib/movies.js, or test/hevc_node.mjs) checked: its video
// frames read back with lib/asf.js (the skipped ones left out), decoded by ffmpeg as an H.265 stream, and compared with
// the pictures given to the encoder (test/hevc_node.mjs --yuv): the count of pictures and their PSNR.
//   node test/hevc_check_node.mjs <copy.wmv> <pictures.yuv> [--ffmpeg C:/ffmpeg/ffmpeg.exe]
// Game data: never commit or share what it reads or writes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Asf } from '../lib/asf.js';
import { isSkipped } from '../lib/movies.js';

const args = process.argv.slice(2);
const at = args.indexOf('--ffmpeg');
const FFMPEG = at >= 0 ? args.splice(at, 2)[1] : 'C:/ffmpeg/ffmpeg.exe';
const [copy, yuv] = args;
const asf = new Asf(new Uint8Array(fs.readFileSync(copy)));
const video = asf.mediaObjects().filter((o) => o.stream === asf.videoStream);
const units = video.filter((o) => !isSkipped(o.data));
const stream = path.join(path.dirname(copy), `${path.basename(copy)}.hevc`);
fs.writeFileSync(stream, Buffer.concat(units.map((o) => Buffer.from(o.data))));
const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'info', '-f', 'hevc', '-i', stream,
  '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${asf.width}x${asf.height}`, '-r', '30', '-i', yuv,
  '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' });
const decoded = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'hevc', '-i', stream, '-f', 'null', '-',
  '-stats'], { encoding: 'utf8' });
const frames = [...(decoded.stderr || '').matchAll(/frame=\s*(\d+)/g)].pop()?.[1];  // the last progress line's
const psnr = /average:([\d.inf]+)/.exec(r.stderr || '')?.[1];
if (!psnr) console.log(`(ffmpeg's psnr gave no average: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')})`);
const pictures = fs.statSync(yuv).size / (asf.width * asf.height * 3 / 2);
console.log(`${path.basename(copy)}: ${video.length} frames, ${units.length} H.265 access units ` +
            `(${video.length - units.length} skipped frames kept); ffmpeg decoded ${frames} pictures; ` +
            `${pictures} given to the encoder; PSNR ${psnr} dB${units[0] && units[0].key ? ', first a keyframe' : ''}`);
fs.unlinkSync(stream);
