// culdcept-nx-installer (2026-11-20, the user: re-encode the movies to H.265): an ASF file (the game's .wmv movies) read as
// its media objects and written again with some objects' data replaced: the JavaScript of culdcept-nx's
// tools/hevc_movie.py (its Asf, media_objects and write_asf), which made the test movies the port played.
//
// What is kept: the whole header (the WMV3 stream's properties and sequence header, which the game's player sets its
// decoder up from), every object's presentation time, its replicated data (the stream's payload extensions) but for its
// size, the packet size and the send order. What is new: the packets (the originals' layout: error correction, multiple
// payloads, BYTE padding when it fits), the data object's and the file properties' sizes and counts, the simple index.

const guid = (s) => {
  const h = s.replace(/-/g, '');
  const b = new Uint8Array(16);
  const le = (i, n) => { for (let k = 0; k < n; ++k) b[i + k] = parseInt(h.substr((i + n - 1 - k) * 2, 2), 16); };
  le(0, 4); le(4, 2); le(6, 2);
  for (let k = 8; k < 16; ++k) b[k] = parseInt(h.substr(k * 2, 2), 16);
  return b;
};
const HEADER = guid('75B22630-668E-11CF-A6D9-00AA0062CE6C');
const DATA = guid('75B22636-668E-11CF-A6D9-00AA0062CE6C');
const SIMPLE_INDEX = guid('33000890-E5B1-11CF-89F4-00A0C90349CB');
const FILE_PROPERTIES = guid('8CABDCA1-A947-11CF-8EE4-00C00C205365');
const STREAM_PROPERTIES = guid('B7DC0791-A9B7-11CF-8EE6-00C00C205365');
const VIDEO_MEDIA = guid('BC19EFC0-5B4D-11CF-A8FD-00805F5C442B');

const same = (buf, at, g) => { for (let k = 0; k < 16; ++k) if (buf[at + k] !== g[k]) return false; return true; };
const u64 = (v, at) => Number(v.getBigUint64(at, true));

// A field of the ASF length type `kind` (0 none, 1 byte, 2 word, 3 dword): [value, next offset].
function readLen(v, i, kind) {
  if (kind === 0) return [0, i];
  if (kind === 1) return [v.getUint8(i), i + 1];
  if (kind === 2) return [v.getUint16(i, true), i + 2];
  return [v.getUint32(i, true), i + 4];
}

export class Asf {
  constructor(bytes) {
    const buf = bytes, v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (!same(buf, 0, HEADER)) throw new Error('not an ASF file');
    this.buf = buf;
    this.v = v;
    this.headerSize = u64(v, 16);
    this.videoStream = null;
    for (let i = 30; i < this.headerSize;) {
      const size = u64(v, i + 16);
      if (same(buf, i, FILE_PROPERTIES)) {
        this.fp = i;
        // object header 24, file ID 16, file size, creation date, data packets, play duration, send duration (8 each),
        // preroll 8, flags 4, minimum and maximum data packet size
        this.preroll = u64(v, i + 80);
        this.minPacket = v.getUint32(i + 92, true);
        this.maxPacket = v.getUint32(i + 96, true);
      } else if (same(buf, i, STREAM_PROPERTIES) && same(buf, i + 24, VIDEO_MEDIA)) {
        this.videoStream = v.getUint16(i + 24 + 16 + 16 + 8 + 4 + 4, true) & 0x7f;
        const ts = i + 24 + 16 + 16 + 8 + 4 + 4 + 2 + 4;  // the type-specific data: width, height, 1, format size, BITMAPINFOHEADER
        this.width = v.getUint32(ts, true);
        this.height = v.getUint32(ts + 4, true);
        const biSize = v.getUint32(ts + 11, true);
        this.codecData = buf.slice(ts + 11 + 40, ts + 11 + biSize);  // the WMV3 sequence header
      }
      i += size;
    }
    if (this.minPacket !== this.maxPacket) throw new Error('packets of varying size');
    if (this.videoStream === null) throw new Error('no video stream');
    this.packetSize = this.minPacket;
    this.data = this.headerSize;
    if (!same(buf, this.data, DATA)) throw new Error('no data object after the header');
    this.dataSize = u64(v, this.data + 16);
    this.packets = u64(v, this.data + 40);
    this.after = this.data + this.dataSize;  // the objects after the data object (the simple index)
  }

  // Every media object, in the order its first payload was sent: { stream, number, size, time (ms), key, send, rep,
  // data, sends }. 2026-11-20: `sends` is each of its payloads' [offset, packet send time], and this.packetsEnd the
  // last packet's send time plus its duration, for write()'s send times and durations.
  mediaObjects() {
    const { buf, v } = this;
    const open = new Map(), order = [];
    this.packetsEnd = 0;
    let p = this.data + 50;
    for (let n = 0; n < this.packets; ++n, p += this.packetSize) {
      let i = p;
      const ec = buf[i];
      if (ec & 0x80) i += 1 + (ec & 0x0f);
      const flags = buf[i], props = buf[i + 1];
      i += 2;
      const multiple = flags & 1;
      let packetLen, padding;
      [packetLen, i] = readLen(v, i, (flags >> 5) & 3);
      [, i] = readLen(v, i, (flags >> 1) & 3);  // sequence
      [padding, i] = readLen(v, i, (flags >> 3) & 3);
      const send = v.getUint32(i, true), duration = v.getUint16(i + 4, true);
      this.packetsEnd = Math.max(this.packetsEnd, send + duration);
      i += 6;
      if (!packetLen) packetLen = this.packetSize;
      const end = p + packetLen - padding;
      const repT = props & 3, offT = (props >> 2) & 3, numT = (props >> 4) & 3;
      let count = 1, lenT = 0;
      if (multiple) { count = buf[i] & 0x3f; lenT = (buf[i] >> 6) & 3; ++i; }
      for (let k = 0; k < count; ++k) {
        const sb = buf[i++];
        let number, offset, repLen, plen;
        [number, i] = readLen(v, i, numT);
        [offset, i] = readLen(v, i, offT);
        [repLen, i] = readLen(v, i, repT);
        if (repLen === 1) throw new Error('compressed payloads are not handled');
        const objSize = v.getUint32(i, true), time = v.getUint32(i + 4, true);
        const rep = buf.slice(i, i + repLen);
        i += repLen;
        if (multiple) [plen, i] = readLen(v, i, lenT); else plen = end - i;
        const key = (sb & 0x7f) * 65536 + number;
        let o = open.get(key);
        if (!o || (offset === 0 && o.filled >= o.size)) {
          o = { stream: sb & 0x7f, number, size: objSize, time, key: !!(sb & 0x80), send, rep,
                data: new Uint8Array(objSize), filled: 0, sends: [] };
          open.set(key, o);
          order.push(o);
        }
        o.sends.push([offset, send]);
        o.data.set(buf.subarray(i, i + plen), offset);
        o.filled += plen;
        i += plen;
      }
    }
    for (const o of order) {
      if (o.filled !== o.size) throw new Error(`stream ${o.stream} object ${o.number}: ${o.filled} of ${o.size} bytes`);
      delete o.filled;
    }
    return order;
  }

  // The file again with `objs` (from mediaObjects(), some data replaced): a Uint8Array.
  // 2026-11-20 (the console: the H.265 movies played slowly and without sound): each packet's send time is the original
  // send time of the bytes it starts with (for a replaced object, of the same fraction of the original's bytes), never
  // earlier than the packet before's, and its duration the time to the next packet's, as the originals have them. This
  // writer had given every packet the send time of its first object's first byte and a duration of 0: the game's
  // player paces itself by them (the original CI_01 written again unchanged played in 11.3 s instead of 6.8).
  write(objs) {
    const P = this.packetSize;
    const packets = [];
    const span = new Map();  // object -> [first packet, packet count]
    let pkt = null, lastSend = 0;
    const sendAt = (o, offset) => {
      const f = o.sends;
      if (!f || !f.length) return o.send;
      const x = o.data.length ? offset * o.size / o.data.length : 0;  // the same fraction of the original object
      let t = f[0][1];
      for (const [off, snd] of f) { if (off <= x) t = snd; else break; }
      return t;
    };
    // 2026-11-20: an audio object (any but the video's) is never split across packets, as the originals' muxer never
    // splits one: the game's player lost a split one's audio, played the movie without sound and paced it slower
    // (CI_01 written again unchanged but with 5 of its 19 audio objects split: 11.3 s instead of 6.8). One that does
    // not fit in the packet being filled waits for the next packet, which it starts, and the video goes on filling
    // this one, as the originals' muxer does (a new packet for each would leave most of the one before empty: the
    // narrations 10 % larger).
    const deferred = [];
    const newPacket = (o, offset) => {
      if (pkt) packets.push(pkt);
      lastSend = Math.max(lastSend, sendAt(o, offset));
      pkt = { send: lastSend, payloads: [], used: 13 };  // EC 3, flags 2, BYTE padding 1, send 4, duration 2, flags 1
    };
    const place = (o, offset, take, over) => {
      pkt.payloads.push([o, offset, take]);
      pkt.used += over + take;
      const s = span.get(o) || [packets.length, 0];
      s[1] = packets.length - s[0] + 1;
      span.set(o, s);
    };
    const fits = (o, over) => pkt && pkt.payloads.length < 63 && pkt.used + over + o.data.length <= P;
    // the waiting whole objects at the start of a new packet (each fits in an empty one)
    const flush = () => {
      while (deferred.length) {
        const [d, dover] = deferred[0];
        if (!fits(d, dover)) newPacket(d, 0);
        if (!fits(d, dover)) throw new Error(`stream ${d.stream} object ${d.number} (${d.data.length} bytes) fits in no packet`);
        place(d, 0, d.data.length, dover);
        deferred.shift();
      }
    };
    for (const o of objs) {
      const over = 9 + o.rep.length;  // stream, number, offset, replicated length, replicated data, payload length
      const whole = o.stream !== this.videoStream && 13 + over + o.data.length <= P;
      if (whole) {
        if (!deferred.length && fits(o, over)) place(o, 0, o.data.length, over);
        else deferred.push([o, over]);  // after the ones already waiting, in their order
        continue;
      }
      let offset = 0;
      for (;;) {
        if (!pkt || pkt.payloads.length >= 63 || pkt.used + over + 1 > P) {
          newPacket(o, offset);
          flush();  // the waiting audio first in the new packet
          if (pkt.payloads.length >= 63 || pkt.used + over + 1 > P) newPacket(o, offset);
        }
        const take = Math.min(P - pkt.used - over, o.data.length - offset);
        place(o, offset, take, over);
        offset += take;
        if (offset >= o.data.length) break;
      }
    }
    flush();
    if (pkt) packets.push(pkt);
    packets.forEach((p, k) => {
      const next = k + 1 < packets.length ? packets[k + 1].send : Math.max(this.packetsEnd || 0, p.send);
      p.duration = Math.min(0xffff, Math.max(0, next - p.send));
    });

    // the simple index: for each interval, the packet where the last video keyframe at or before it starts
    const tail = [];
    const { buf, v } = this;
    for (let i = this.after; i + 24 <= buf.length;) {
      const size = u64(v, i + 16);
      if (same(buf, i, SIMPLE_INDEX)) {
        const interval = u64(v, i + 40), count = v.getUint32(i + 52, true);
        const keys = objs.filter((o) => o.stream === this.videoStream && o.key)
          .map((o) => [o.time - this.preroll, ...span.get(o)]);
        const obj = new Uint8Array(56 + count * 6);
        obj.set(buf.subarray(i, i + 56));
        const ov = new DataView(obj.buffer);
        let k = 0, maxCount = 1;
        for (let e = 0; e < count; ++e) {
          const t = Math.floor(e * interval / 10000);
          while (k + 1 < keys.length && keys[k + 1][0] <= t) ++k;
          const [pn, pc] = keys.length ? [keys[k][1], keys[k][2]] : [0, 1];
          maxCount = Math.max(maxCount, pc);
          ov.setUint32(56 + e * 6, pn, true);
          ov.setUint16(56 + e * 6 + 4, pc, true);
        }
        ov.setUint32(48, maxCount, true);
        ov.setBigUint64(16, BigInt(obj.length), true);
        tail.push(obj);
      } else {
        tail.push(buf.subarray(i, i + size));
      }
      i += size;
    }

    const bodyLen = packets.length * P;
    const tailLen = tail.reduce((n, t) => n + t.length, 0);
    const total = this.headerSize + 50 + bodyLen + tailLen;
    const out = new Uint8Array(total);
    const w = new DataView(out.buffer);
    out.set(buf.subarray(0, this.headerSize + 50));
    w.setBigUint64(this.fp + 40, BigInt(total), true);          // the file properties: the file's size
    w.setBigUint64(this.fp + 56, BigInt(packets.length), true); // the data packets
    w.setBigUint64(this.data + 16, BigInt(50 + bodyLen), true); // the data object's size
    w.setBigUint64(this.data + 40, BigInt(packets.length), true);
    let at = this.headerSize + 50;
    for (const p of packets) {
      const start = at;
      out[at++] = 0x82; out[at++] = 0; out[at++] = 0;  // error correction: 2 bytes
      let padding = P - p.used;
      if (padding <= 255) {
        out[at++] = 0x09; out[at++] = 0x5d; out[at++] = padding;
      } else {
        padding -= 1;  // the WORD field takes one byte more
        out[at++] = 0x11; out[at++] = 0x5d; w.setUint16(at, padding, true); at += 2;
      }
      w.setUint32(at, p.send, true); at += 4;
      w.setUint16(at, p.duration, true); at += 2;
      out[at++] = 0x80 | p.payloads.length;  // WORD payload lengths
      for (const [o, off, take] of p.payloads) {
        out[at++] = (o.key ? 0x80 : 0) | o.stream;
        out[at++] = o.number & 0xff;
        w.setUint32(at, off, true); at += 4;
        out[at++] = o.rep.length;
        out.set(o.rep, at);
        w.setUint32(at, o.data.length, true);  // the new size; time and extensions as they were
        at += o.rep.length;
        w.setUint16(at, take, true); at += 2;
        out.set(o.data.subarray(off, off + take), at); at += take;
      }
      at = start + P;  // the padding stays zero
    }
    for (const t of tail) { out.set(t, at); at += t.length; }
    return out;
  }
}
