// nights-nx-installer (2026-11-22): the pictures lib/movies.js takes from a movie (the ones the game's decoder shows,
// from wasm/vc1), as FNV-1a 64 hashes of their I420 bytes: the same hash nights-nx logs for each picture a movie shows
// (nights_wmv_log_hashes), so the two lists can be compared. Node 24, from this folder:
//   node test/pictures_node.mjs <movie.wmv> [<nights-nx log with [wmv] shown lines> <its movie's number, from 1>]
// Game data: never commit or share what it reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Asf } from '../lib/asf.js';
import { showPictures } from '../lib/movies.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [movie, logPath, which] = process.argv.slice(2);
const asf = new Asf(new Uint8Array(fs.readFileSync(movie)));
const video = asf.mediaObjects().filter((o) => o.stream === asf.videoStream);
const { default: createVc1Module } = await import(pathToFileURL(path.join(root, 'wasm', 'vc1.mjs')).href);
const vc1 = await createVc1Module();
const fnv = (b) => {
  let h = 0xcbf29ce484222325n;
  for (const x of b) h = BigInt.asUintN(64, (h ^ BigInt(x)) * 0x100000001b3n);
  return h.toString(16).toUpperCase().padStart(16, '0');
};
const mine = [];
for (const [i, i420] of showPictures(asf, video, vc1)) mine.push({ i, time: video[i].time, hash: fnv(i420) });
console.log(`${path.basename(movie)}: ${asf.width}x${asf.height}, ${video.length} frames, ${mine.length} pictures shown`);
if (logPath) {
  const re = /\[wmv\] shown ([0-9A-F]{8}) #(\d+) (\d+x\d+) pts (\d+): (\S+)/;
  const movies = [];
  for (const line of fs.readFileSync(logPath, 'utf8').split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    if (m[2] === '1') movies.push([]);
    movies[movies.length - 1].push({ pts: Number(m[4]), hash: m[5] });
  }
  const theirs = movies[Number(which || 1) - 1] || [];
  const n = Math.min(theirs.length, mine.length);
  let same = 0;
  const diff = [];
  for (let k = 0; k < n; ++k) {
    if (theirs[k].hash === mine[k].hash) ++same;
    else diff.push(k + 1);
  }
  console.log(`the log's movie ${which || 1}: ${theirs.length} pictures; first ${n} compared: ${same} identical` +
              (diff.length ? `, different at ${diff.slice(0, 10).join(', ')}` : ''));
}
