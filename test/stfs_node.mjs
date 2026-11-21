// nights-nx-installer (2026-11-22): lists a content package as lib/stfs.js reads it (the page's "packages" choice) and,
// given the folder the same game was extracted to, checks that every file of the folder is in the package with the same
// size and bytes. Node 24, from this folder:
//   node test/stfs_node.mjs <package file> [<extracted folder>]
// Game data: never commit or share what it reads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StfsPackage } from '../lib/stfs.js';

const [pkgPath, folder] = process.argv.slice(2);
const fd = fs.openSync(pkgPath, 'r');
const size = fs.fstatSync(fd).size;
const file = {
  size,
  read: async (offset, length) => {
    const b = Buffer.alloc(length);
    fs.readSync(fd, b, 0, length, offset);
    return new Uint8Array(b.buffer, b.byteOffset, length);
  },
};
const pkg = await StfsPackage.open(file);
const files = pkg.files();
const bytes = files.reduce((n, f) => n + f.size, 0);
console.log(`${path.basename(pkgPath)}: title ${pkg.header.titleId.toString(16)}, content ${pkg.header.contentType.toString(16)}, ` +
            `${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
if (folder) {
  const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : [rel + e.name]);
  const want = walk(folder);
  const byPath = new Map(files.map((f) => [f.path.toLowerCase(), f]));
  let missing = 0, differ = 0, checked = 0;
  for (const p of want) {
    const f = byPath.get(p.toLowerCase());
    if (!f) {
      if (++missing <= 10) console.log(`missing from the package: ${p}`);
      continue;
    }
    const a = fs.readFileSync(path.join(folder, p));
    const b = await f.read(0, f.size);
    const same = a.length === b.length && crypto.createHash('md5').update(a).digest('hex') ===
      crypto.createHash('md5').update(b).digest('hex');
    if (!same && ++differ <= 10) console.log(`different: ${p} (${a.length} bytes in the folder, ${b.length} read)`);
    ++checked;
  }
  console.log(`${want.length} files in the folder: ${checked} found, ${missing} missing, ${differ} different`);
}
