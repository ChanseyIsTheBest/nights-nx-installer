// culdcept-nx-installer (2026-11-20, from rr6-nx-installer's test/pack_node.mjs): packs a game folder as the page does,
// each file by game.json's "lz4" / "zxc" (lib/lz4b.js on test/pack_worker_node.mjs threads), into a folder laid out as the
// zip's game_root/: NAME.lz4b for a packed file, and with --link-rest every other file hard-linked (same drive) or copied,
// so the folder is a whole game_root to run the port on. Check packed files with the port's tools/test_lz4_blocks.cpp.
// Node 24, from this folder:
//   node test/pack_node.mjs <game folder> <out folder> [--only <regex of paths>] [--link-rest]
// Game data: never commit or share what it writes.
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { CODECS, pack, SUFFIX } from '../lib/lz4b.js';
import { workerPool } from '../lib/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const linkRest = args.includes('--link-rest');
if (linkRest) args.splice(args.indexOf('--link-rest'), 1);
const only = flag('--only');
const [gameDir, outDir] = args;
if (!gameDir || !outDir) {
  console.error('usage: node test/pack_node.mjs <game folder> <out folder> [--only <regex>] [--link-rest]');
  process.exit(2);
}
const game = JSON.parse(fs.readFileSync(path.join(here, '..', 'game.json'), 'utf8'));
const patterns = (list) => (list || []).map((p) => new RegExp(`^(?:${p})$`, 'i'));
const matches = (res, p) => res.some((re) => re.test(p));
const lz4 = patterns(game.lz4), zxc = patterns(game.zxc), skip = patterns(game.skip);
const codecOf = (p) => (matches(zxc, p) ? 'zxc' : matches(lz4, p) ? 'lz4' : null);  // as lib/install.js
const onlyRe = only ? new RegExp(only, 'i') : null;

const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : [rel + e.name]);
const files = walk(gameDir).filter((p) => !matches(skip, p) && (!onlyRe || onlyRe.test(p)));

const count = Math.max(1, availableParallelism() - 1);
const workers = await Promise.all(Array.from({ length: count }, async () => {
  const w = new Worker(path.join(here, 'pack_worker_node.mjs'));
  const ready = await new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
  return { post: (m, t) => w.postMessage(m, t), onMessage: (cb) => w.on('message', cb), w, ...ready };
}));
const v = (n) => `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}`;
console.log(`LZ4 ${v(workers[0].version)}, ZXC ${v(workers[0].zxcVersion)} on ${count} worker threads`);
const pool = workerPool(workers);
const compress = (bytes, codec) =>
  pool.run({ bytes, codec, level: CODECS[codec].level, block: CODECS[codec].block }, [bytes.buffer]).then((r) => r.bytes);

const totals = { lz4: [0, 0, 0], zxc: [0, 0, 0], rest: [0, 0, 0] };
const began = performance.now();
for (const rel of files) {
  const src = path.join(gameDir, rel);
  const codec = codecOf(rel);
  fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
  const { size } = fs.statSync(src);
  if (!codec) {
    if (linkRest) {
      const dst = path.join(outDir, rel);
      fs.rmSync(dst, { force: true });
      try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
      totals.rest[0] += 1; totals.rest[1] += size; totals.rest[2] += size;
    }
    continue;
  }
  const handle = await fs.promises.open(src, 'r');
  const file = {
    size,
    async read(offset, length) {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new Error(`${rel}: short read`);
      return buffer;
    },
  };
  const target = path.join(outDir, rel + SUFFIX);
  const out = fs.createWriteStream(target);
  let written = 0;
  for await (const chunk of pack(file, compress, { codec, inFlight: count * 4 })) {
    written += chunk.length;
    if (!out.write(chunk)) await once(out, 'drain');
  }
  out.end();
  await once(out, 'finish');
  await handle.close();
  const t = totals[codec];
  t[0] += 1; t[1] += size; t[2] += written;
  if (size >= 8 << 20) console.log(`${rel} (${codec}): ${(size / 1048576).toFixed(1)} MB -> ${(written / 1048576).toFixed(1)} MB (${(written / size * 100).toFixed(1)} %)`);
}
for (const [name, [n, a, b]] of Object.entries(totals)) {
  if (n) console.log(`${name}: ${n} files, ${(a / 1048576).toFixed(0)} MB -> ${(b / 1048576).toFixed(0)} MB` + (a ? ` (${(b / a * 100).toFixed(1)} %)` : ''));
}
console.log(`done in ${((performance.now() - began) / 1000).toFixed(0)} s`);
for (const { w } of workers) await w.terminate();
