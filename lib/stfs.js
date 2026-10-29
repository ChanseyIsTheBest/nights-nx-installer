// Reads an Xbox 360 STFS content package (LIVE, PIRS or CON): its header and the files inside, without extracting
// them. A port of tools/stfs_extract.py of sa2-nx (the same arithmetic as Xenia's STFS device). The package is only
// read, never changed.
//
// futari-nx-installer only reads package headers with it: Mushihimesama Futari's two marketplace packages (content type
// 0x00000002, title 435A07D7), Black Label and the Ver 1.01 unlock, are recognised by their header and copied as they
// are (the game installs them from dlc/ at its first start).

const BLOCK = 0x1000;
const PER_TABLE = 170; // blocks per hash table (level 0); a level-1 table covers 170 * 170 blocks, and so on
const LEVEL_BASE = [PER_TABLE, PER_TABLE ** 2, PER_TABLE ** 3];
// one read covers this many data blocks at most (16 MB), with the hash tables between them
const READ_BLOCKS = 4096;

export const CONTENT_GAME = 0x000d0000;
export const CONTENT_DLC = 0x00000002;

function be32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function be24(data, offset) {
  return (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
}

function le24(data, offset) {
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

// The package header: { magic, titleId, contentType, displayName, ... }, or null when `head` (at least the first
// 0x600 bytes of the file) is not an STFS package.
export function readStfsHeader(head) {
  if (head.length < 0x600) {
    return null;
  }
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (magic !== 'LIVE' && magic !== 'PIRS' && magic !== 'CON ') {
    return null;
  }
  let displayName = '';
  for (let i = 0x411; i + 1 < 0x491; i += 2) {
    const c = (head[i] << 8) | head[i + 1];
    if (!c) {
      break;
    }
    displayName += String.fromCharCode(c);
  }
  return {
    magic,
    headerSize: be32(head, 0x340),
    contentType: be32(head, 0x344),
    titleId: be32(head, 0x360),
    svod: head[0x3a9] !== 0,
    displayName,
  };
}

export class StfsPackage {
  // file: { size, read(offset, length) -> Promise<Uint8Array> }
  constructor(file, header, volume) {
    this.file = file;
    this.header = header;
    Object.assign(this, volume);
  }

  static async open(file) {
    const head = await file.read(0, Math.min(file.size, 0xa000));
    const header = readStfsHeader(head);
    if (!header) {
      throw new Error('not an Xbox 360 content package');
    }
    if (header.svod) {
      throw new Error('this package is an SVOD volume, not STFS');
    }
    const vd = 0x379;
    // A read-only volume keeps one copy of each hash table, a writable one two.
    const readOnly = Boolean(head[vd + 2] & 1);
    const volume = {
      tablesPerLevel: readOnly ? 1 : 2,
      fileTableBlocks: head[vd + 3] | (head[vd + 4] << 8),
      fileTableStart: le24(head, vd + 5),
      dataBase: (header.headerSize + BLOCK - 1) & ~(BLOCK - 1),
    };
    const pkg = new StfsPackage(file, header, volume);
    pkg.tableCache = new Map();
    pkg.entries = await pkg.readEntries();
    return pkg;
  }

  // Data block number -> physical block number, skipping the interleaved hash tables (Xenia's BlockToOffsetSTFS).
  physical(block) {
    let out = block;
    for (const base of LEVEL_BASE) {
      out += Math.floor((block + base) / base) * this.tablesPerLevel;
      if (block < base) {
        break;
      }
    }
    return out;
  }

  offset(block) {
    return this.dataBase + this.physical(block) * BLOCK;
  }

  // The next block of a chain: its level-0 hash entry, in the table right before the group's first data block. A
  // writable package keeps two copies of each table and marks the current one; this reads the first copy, which is
  // right for read-only packages (Xbox Live Arcade games and DLC are) and for files stored in consecutive blocks.
  async nextBlock(block) {
    const groupFirst = Math.floor(block / PER_TABLE) * PER_TABLE;
    const table = this.dataBase + (this.physical(groupFirst) - this.tablesPerLevel) * BLOCK;
    let bytes = this.tableCache.get(table);
    if (!bytes) {
      bytes = await this.file.read(table, BLOCK);
      this.tableCache.set(table, bytes);
    }
    return be24(bytes, (block % PER_TABLE) * 0x18 + 0x15);
  }

  async chain(start, count, consecutive) {
    const blocks = new Array(count);
    let block = start;
    for (let i = 0; i < count; i++) {
      blocks[i] = block;
      if (i + 1 < count) {
        block = consecutive ? block + 1 : await this.nextBlock(block);
      }
    }
    return blocks;
  }

  // The file table: [{ path, size, start, blocks, consecutive }] for every file ('/' between folder names).
  async readEntries() {
    const tableBlocks = await this.chain(this.fileTableStart, this.fileTableBlocks, false);
    const raw = await this.readBlocks(tableBlocks, tableBlocks.length * BLOCK);
    const records = [];
    for (let i = 0; i + 0x40 <= raw.length; i += 0x40) {
      const length = raw[i + 0x28] & 0x3f;
      if (!length) {
        continue;
      }
      let name = '';
      for (let k = 0; k < length; k++) {
        name += String.fromCharCode(raw[i + k]);
      }
      const parent = (raw[i + 0x32] << 8) | raw[i + 0x33];
      records.push({
        index: i / 0x40,
        name,
        directory: Boolean(raw[i + 0x28] & 0x80),
        consecutive: Boolean(raw[i + 0x28] & 0x40),
        blocks: le24(raw, i + 0x29),
        start: le24(raw, i + 0x2f),
        parent: parent === 0xffff ? -1 : parent,
        size: be32(raw, i + 0x34),
      });
    }
    const byIndex = new Map(records.map((r) => [r.index, r]));
    const pathOf = (record) => {
      const parts = [record.name];
      const seen = new Set();
      while (record.parent !== -1) {
        if (seen.has(record.parent) || !byIndex.has(record.parent)) {
          throw new Error('the package file table is damaged');
        }
        seen.add(record.parent);
        record = byIndex.get(record.parent);
        parts.push(record.name);
      }
      return parts.reverse().join('/');
    };
    return records
      .filter((r) => !r.directory)
      .map((r) => ({ path: pathOf(r), size: r.size, start: r.start, blocks: r.blocks, consecutive: r.consecutive }));
  }

  // The bytes of these data blocks, in order (the last ones cut to `length` bytes in all). Physically adjacent blocks
  // are read together; the hash tables between groups are read along and skipped.
  async readBlocks(blocks, length) {
    const out = new Uint8Array(length);
    let at = 0;
    for (let i = 0; i < blocks.length && at < length; ) {
      // a run of blocks whose physical places only go up, with at most a few hash tables between two of them
      let j = i + 1;
      while (j < blocks.length && j - i < READ_BLOCKS) {
        const gap = this.physical(blocks[j]) - this.physical(blocks[j - 1]);
        if (gap < 1 || gap > 4) {
          break;
        }
        j++;
      }
      const first = this.physical(blocks[i]);
      const last = this.physical(blocks[j - 1]);
      const span = await this.file.read(this.dataBase + first * BLOCK,
        Math.min((last - first + 1) * BLOCK, this.file.size - (this.dataBase + first * BLOCK)));
      for (let k = i; k < j && at < length; k++) {
        const from = (this.physical(blocks[k]) - first) * BLOCK;
        const n = Math.min(BLOCK, length - at);
        if (from + n > span.length) {
          throw new Error('the package is truncated');
        }
        out.set(span.subarray(from, from + n), at);
        at += n;
      }
      i = j;
    }
    return out;
  }

  // A reader for one file of the package, in the form the installer uses for every game file.
  fileReader(entry) {
    let chainOf = null;
    const blockList = async (first, count) => {
      if (entry.consecutive) {
        return Array.from({ length: count }, (_, i) => entry.start + first + i);
      }
      chainOf ??= this.chain(entry.start, entry.blocks, false);
      return (await chainOf).slice(first, first + count);
    };
    return {
      path: entry.path,
      size: entry.size,
      read: async (offset, length) => {
        if (offset < 0 || length < 0 || offset + length > entry.size) {
          throw new Error(`${entry.path}: read outside the file`);
        }
        if (!length) {
          return new Uint8Array(0);
        }
        const first = Math.floor(offset / BLOCK);
        const end = Math.ceil((offset + length) / BLOCK);
        const bytes = await this.readBlocks(await blockList(first, end - first),
          Math.min((end - first) * BLOCK, entry.size - first * BLOCK));
        const skip = offset - first * BLOCK;
        return bytes.subarray(skip, skip + length);
      },
    };
  }

  files() {
    return this.entries.map((e) => this.fileReader(e));
  }
}
