// banjo-nx-installer: LZX, as reNut's tools/dump_shaders.py decodes Rare's bundles (its LZXDecoder: libmspack lzxd
// semantics, 16-bit little-endian words read most significant bit first, one decoder per partition, one call per
// frame), ported line for line to JavaScript: the Python one is far too slow for the 1.9 GB of compressed bundles in
// Pyodide. py/banjo_dump.py calls decodePartition() in place of the Python decoder.

const EXTRA_BITS = [];
for (let i = 0, j = 0; i < 52; i += 2) {
  EXTRA_BITS.push(j, j);
  if (i !== 0 && j < 17) j++;
}
const POSITION_BASE = [];
for (let i = 0, j = 0; i < 52; i++) {
  POSITION_BASE.push(j);
  j += 2 ** EXTRA_BITS[i];
}
const POSN_SLOTS = { 15: 30, 16: 32, 17: 34, 18: 36, 19: 38, 20: 42, 21: 50 };
const VERBATIM = 1, ALIGNED = 2, UNCOMPRESSED = 3;

class BitReader {
  constructor(d) { this.d = d; this.p = 0; this.buf = 0; this.n = 0; }
  fill(need) {
    const d = this.d;
    while (this.n < need) {
      const p = this.p;
      let w = 0;
      if (p + 1 < d.length) w = d[p] | (d[p + 1] << 8);
      else if (p < d.length) w = d[p];
      this.p = p + 2;
      this.buf = this.buf * 65536 + w;  // at most 33 bits: exact in a double
      this.n += 16;
    }
  }
  peek(k) {
    if (this.n < k) this.fill(k);
    return Math.floor(this.buf / 2 ** (this.n - k)) % 2 ** k;
  }
  skip(k) {
    this.n -= k;
    this.buf %= 2 ** this.n;
  }
  read(k) {
    if (k === 0) return 0;
    const v = this.peek(k);
    this.skip(k);
    return v;
  }
}

class Huffman {
  constructor(lens) {
    let maxbits = 0;
    for (const l of lens) if (l > maxbits) maxbits = l;
    this.maxbits = maxbits;
    if (maxbits === 0) { this.table = null; return; }
    const size = 1 << maxbits;
    const table = new Int32Array(size);
    let code = 0, filled = 0;
    for (let L = 1; L <= maxbits; L++) {
      const span = 1 << (maxbits - L);
      for (let sym = 0; sym < lens.length; sym++) {
        if (lens[sym] === L) {
          const start = code << (maxbits - L);
          table.fill((sym << 5) | L, start, start + span);
          filled += span;
          code++;
        }
      }
      code <<= 1;
    }
    if (filled > size) throw new Error('oversubscribed huffman table');
    this.table = table;
  }
  decode(br) {
    if (this.table === null) throw new Error('empty huffman table used');
    const e = this.table[br.peek(this.maxbits)];
    br.skip(e & 31);
    return e >> 5;
  }
}

export class LzxDecoder {
  constructor(windowBits = 17) {
    if (!(windowBits in POSN_SLOTS)) throw new Error(`unsupported LZX window bits ${windowBits}`);
    this.windowSize = 1 << windowBits;
    this.posnSlots = POSN_SLOTS[windowBits];
    // The Python bytearray may grow past the window by a match's overrun: the same slack here.
    this.window = new Uint8Array(this.windowSize + 512);
    this.wpos = 0;
    this.R0 = this.R1 = this.R2 = 1;
    this.mainLens = new Array(256 + this.posnSlots * 8).fill(0);
    this.lenLens = new Array(249).fill(0);
    this.headerRead = false;
    this.blockType = 0;
    this.blockRemaining = 0;
    this.blockLength = 0;
    this.mainTree = this.lenTree = this.alignedTree = null;
  }

  readLengths(br, lens, first, last) {
    const preLens = [];
    for (let i = 0; i < 20; i++) preLens.push(br.read(4));
    const pre = new Huffman(preLens);
    let x = first;
    while (x < last) {
      let z = pre.decode(br);
      if (z === 17) {
        const y = br.read(4) + 4;
        for (let k = 0; k < y; k++) lens[x + k] = 0;
        x += y;
      } else if (z === 18) {
        const y = br.read(5) + 20;
        for (let k = 0; k < y; k++) lens[x + k] = 0;
        x += y;
      } else if (z === 19) {
        const y = br.read(1) + 4;
        z = lens[x] - pre.decode(br);
        if (z < 0) z += 17;
        for (let k = 0; k < y; k++) lens[x + k] = z;
        x += y;
      } else {
        z = lens[x] - z;
        if (z < 0) z += 17;
        lens[x] = z;
        x += 1;
      }
    }
  }

  readBlockHeader(br) {
    if (this.blockType === UNCOMPRESSED && (this.blockLength & 1)) br.p += 1;
    const bt = this.blockType = br.read(3);
    const hi = br.read(16);
    const lo = br.read(8);
    this.blockLength = this.blockRemaining = hi * 256 + lo;
    if (bt === ALIGNED) {
      const a = [];
      for (let i = 0; i < 8; i++) a.push(br.read(3));
      this.alignedTree = new Huffman(a);
    }
    if (bt === VERBATIM || bt === ALIGNED) {
      this.readLengths(br, this.mainLens, 0, 256);
      this.readLengths(br, this.mainLens, 256, 256 + this.posnSlots * 8);
      this.mainTree = new Huffman(this.mainLens);
      this.readLengths(br, this.lenLens, 0, 249);
      this.lenTree = this.lenLens.some((l) => l) ? new Huffman(this.lenLens) : null;
    } else if (bt === UNCOMPRESSED) {
      br.fill(16);
      if (br.n > 16) br.p -= 2;
      br.n = 0;
      br.buf = 0;
      const d = br.d, p = br.p;
      const le32 = (o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
      this.R0 = le32(p); this.R1 = le32(p + 4); this.R2 = le32(p + 8);
      br.p = p + 12;
    } else {
      throw new Error(`bad LZX block type ${bt}`);
    }
  }

  // data: one frame's compressed bytes; returns its frameSize decoded bytes (a copy).
  decompressFrame(data, frameSize) {
    const br = new BitReader(data);
    if (!this.headerRead) {
      if (br.read(1)) throw new Error('intel E8 translation is not supported');
      this.headerRead = true;
    }
    const outStart = this.wpos;
    const window = this.window;
    const wmask = this.windowSize - 1;
    let remaining = frameSize;
    while (remaining > 0) {
      if (this.blockRemaining === 0) this.readBlockHeader(br);
      const thisRun = Math.min(this.blockRemaining, remaining);
      remaining -= thisRun;
      this.blockRemaining -= thisRun;
      let wpos = this.wpos;
      const end = wpos + thisRun;
      const bt = this.blockType;
      if (bt === UNCOMPRESSED) {
        const p = br.p;
        window.set(data.subarray(p, p + thisRun), wpos);
        br.p = p + thisRun;
        wpos = end;
      } else {
        const main = this.mainTree, lent = this.lenTree, alg = this.alignedTree;
        let R0 = this.R0, R1 = this.R1, R2 = this.R2;
        while (wpos < end) {
          let me = main.decode(br);
          if (me < 256) { window[wpos++] = me; continue; }
          me -= 256;
          let ml = me & 7;
          if (ml === 7) ml += lent.decode(br);
          ml += 2;
          let mo = me >> 3;
          if (mo > 2) {
            const eb = EXTRA_BITS[mo];
            if (bt === VERBATIM) {
              mo = mo !== 3 ? POSITION_BASE[mo] - 2 + br.read(eb) : 1;
            } else {
              mo = POSITION_BASE[mo] - 2;
              if (eb > 3) { mo += br.read(eb - 3) * 8; mo += alg.decode(br); }
              else if (eb === 3) mo += alg.decode(br);
              else if (eb > 0) mo += br.read(eb);
              else mo = 1;
            }
            R2 = R1; R1 = R0; R0 = mo;
          } else if (mo === 0) {
            mo = R0;
          } else if (mo === 1) {
            mo = R1; R1 = R0; R0 = mo;
          } else {
            mo = R2; R2 = R0; R0 = mo;
          }
          const src = wpos - mo;
          if (src >= 0 && src + ml <= wpos) {
            window.copyWithin(wpos, src, src + ml);
          } else {
            for (let k = 0; k < ml; k++) window[wpos + k] = window[(src + k) & wmask];
          }
          wpos += ml;
        }
        this.R0 = R0; this.R1 = R1; this.R2 = R2;
        if (wpos !== end) {
          const overrun = wpos - end;
          remaining -= overrun;
          this.blockRemaining -= overrun;
        }
      }
      this.wpos = wpos;
    }
    if (this.blockRemaining === 0 && this.blockType === UNCOMPRESSED) this.blockLength = 0;
    const out = window.slice(outStart, outStart + frameSize);
    if (this.wpos >= this.windowSize) this.wpos &= wmask;
    return out;
  }
}

// One partition of a Rare LZX container (dump_shaders.py RareLZXSource._part): frames = [size, offset, length, ...]
// into data (the whole file). Returns the partition's bytes.
export function decodePartition(data, windowBits, frames) {
  const dec = new LzxDecoder(windowBits);
  let total = 0;
  for (let i = 0; i < frames.length; i += 3) total += frames[i];
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i < frames.length; i += 3) {
    const n = frames[i], o = frames[i + 1], c = frames[i + 2];
    out.set(dec.decompressFrame(data.subarray(o, o + c), n), at);
    at += n;
  }
  return out;
}
