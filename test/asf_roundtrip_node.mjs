// nights-nx-installer (2026-11-22): lib/asf.js on a movie: its objects read and written again unchanged, and the result
// compared with the original (the same bytes when the writer lays the packets out as the original's muxer did).
//   node test/asf_roundtrip_node.mjs [--out <folder>] <movie.wmv> [...]
// --out writes each movie written again there (for a run of nights-nx with the game's own decoder: the same pictures
// at the same times show the remux is one the game's player takes as it took the original).
// Game data: never commit or share what it reads or writes.
import fs from 'node:fs';
import path from 'node:path';
import { Asf } from '../lib/asf.js';

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const outDir = at >= 0 ? args.splice(at, 2)[1] : null;
for (const movie of args) {
  const bytes = new Uint8Array(fs.readFileSync(movie));
  const asf = new Asf(bytes);
  const objs = asf.mediaObjects();
  const video = objs.filter((o) => o.stream === asf.videoStream);
  const out = asf.write(objs);
  let first = -1;
  const n = Math.min(out.length, bytes.length);
  for (let i = 0; i < n; ++i) if (out[i] !== bytes[i]) { first = i; break; }
  const same = first < 0 && out.length === bytes.length;
  if (outDir) fs.writeFileSync(path.join(outDir, path.basename(movie)), out);
  console.log(`${path.basename(movie)}: ${asf.width}x${asf.height}, ${objs.length} objects (${video.length} video, ` +
              `${video.filter((o) => o.data.length <= 1).length} skipped), packets of ${asf.packetSize} bytes: ` +
              (same ? 'written again byte for byte' : `differs (${out.length} against ${bytes.length} bytes, first at ${first})`));
}
