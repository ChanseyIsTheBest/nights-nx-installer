// nights-nx-installer: makes the package off the page's thread and streams the zip to the download service worker
// (sw.js). From banjo-nx-installer's worker.js (its shader build, lib/build.js, unchanged), with futari-nx-installer's
// XEX and STFS readers (sa2-nx-installer's) for NiGHTS's Xbox Live Arcade packages, and NiGHTS's own shader dump
// (lib/nights_dump.js) in place of Nuts & Bolts' bundle reader. GPL-3.0.
import createRenutHlslModule from './wasm/renut_hlsl.mjs';
import createLzxModule from './wasm/lzx.mjs';
import { compileVariants, makeGlsl, packageShaders, variantJobs } from './lib/build.js';
import { CODECS, pack, SUFFIX } from './lib/lz4b.js';
import { fileContainer, imageContainers, isShaderFile } from './lib/nights_dump.js';
import { nroShaders } from './lib/nro.js';
import { glslMaker, uamCompile, workerPool } from './lib/pool.js';
import { StfsPackage } from './lib/stfs.js';
import { parseVariants } from './lib/variants.js';
import { readXexImage } from './lib/xex.js';
import { ZipWriter, zipSize } from './lib/zip.js';

const ROOT = 'switch/nights-nx';
const GAME_TITLE = 0x58411268;
const CONTENT_GAME = 0x000d0000, CONTENT_UPDATE = 0x000b0000;
const log = (text) => postMessage({ type: 'log', text });
// The steps' shares of the bar: the shaders take the time, the zip the bytes.
const STEPS = { dump: [0, 0.05], glsl: [0.05, 0.45], uam: [0.45, 0.7], zip: [0.7, 1] };
const progress = (step) => (f) => {
  const [a, b] = STEPS[step];
  postMessage({ type: 'progress', fraction: a + (b - a) * f });
};

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A release file, checked against the SHA-256 the manifest gives for it.
async function fetchChecked(name, hash) {
  const bytes = await fetchBytes(`./release/${name}`);
  const got = await sha256(bytes);
  if (hash && got !== hash) throw new Error(`release/${name} is not the one the manifest names (${got})`);
  return bytes;
}

// Sends every write as one chunk, and only when the download has asked for more ("pull").
function portSink(port) {
  let credits = 0, cancelled = false, waiting = null;
  port.onmessage = ({ data }) => {
    if (data.type === 'pull') credits++;
    else if (data.type === 'cancel') cancelled = true;
    if (waiting) { const wake = waiting; waiting = null; wake(); }
  };
  return {
    async write(bytes) {
      while (!credits) {
        if (cancelled) throw new Error('the download was cancelled');
        await new Promise((resolve) => (waiting = resolve));
      }
      if (cancelled) throw new Error('the download was cancelled');
      credits--;
      const copy = bytes.slice();
      port.postMessage({ type: 'chunk', buffer: copy.buffer }, [copy.buffer]);
    },
    async close() { port.postMessage({ type: 'end' }); },
    fail(message) { port.postMessage({ type: 'error', message }); },
  };
}

// A File (or Blob) as { size, read(offset, length) }.
const blobReader = (blob) => ({
  size: blob.size,
  read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
});

// The game's files, { path (in game_root), size, read(offset, length) }, from what the page was given:
//   { folder: [{ path, size, file }] }  the folder the game was extracted to (default.xex, afs/, ..., and the title
//                                       update's default.xexp beside default.xex);
//   { packages: [File] }                the game's package (title 58411268, content type 0x000D0000) and the title
//                                       update's package (0x000B0000, its default.xexp), read in place (lib/stfs.js);
//                                       a loose default.xexp may come with them.
async function gameFiles(input) {
  if (input.folder) {
    return input.folder.map((e) => ({ path: e.path, size: e.size, read: blobReader(e.file).read }));
  }
  let game = null, update = null;
  const loose = [];
  for (const file of input.packages) {
    if (file.name.toLowerCase() === 'default.xexp') {
      loose.push({ path: 'default.xexp', size: file.size, read: blobReader(file).read });
      continue;
    }
    const pkg = await StfsPackage.open(blobReader(file));
    if (pkg.header.titleId !== GAME_TITLE) throw new Error(`${file.name} is not a NiGHTS into Dreams... package`);
    if (pkg.header.contentType === CONTENT_GAME) game = pkg;
    else if (pkg.header.contentType === CONTENT_UPDATE) update = pkg;
    else throw new Error(`${file.name}: a package of content type ${pkg.header.contentType.toString(16)}, not the game or its update`);
  }
  if (!game) throw new Error('the game\'s package is missing (title 58411268, content type 0x000D0000)');
  const files = game.files().filter((f) => f.path !== 'default.xexp');
  const xexp = update?.files().find((f) => f.path === 'default.xexp') || loose[0];
  if (xexp) files.push({ path: 'default.xexp', size: xexp.size, read: xexp.read });
  return files;
}

async function readWhole(file) {
  return file.read(0, file.size);
}

async function* chunks(file, size = 8 << 20) {
  for (let at = 0; at < file.size; at += size) yield await file.read(at, Math.min(size, file.size - at));
}

const quiet = () => ({ print: () => {}, printErr: () => {} });

// The LZX step of lib/xex.js: libmspack in WebAssembly (futari-nx-installer's).
function lzxStep(lzx) {
  return (compressed, bits, size) => {
    lzx.FS.writeFile('/image.lzx', compressed);
    const rc = lzx.callMain(['/image.lzx', '/image.bin', String(bits), String(size)]);
    if (rc !== 0) throw new Error(`the executable could not be unpacked (LZX error ${rc})`);
    const out = lzx.FS.readFile('/image.bin');
    lzx.FS.unlink('/image.lzx');
    lzx.FS.unlink('/image.bin');
    if (out.length !== size) throw new Error('the executable could not be unpacked (wrong size)');
    return out;
  };
}

// count Web Workers of a script, each started and ready, as lib/pool.js takes them
function startWorkers(script, count) {
  return Promise.all(Array.from({ length: count }, () => new Promise((resolve, reject) => {
    const w = new Worker(script, { type: 'module' });
    w.onerror = (e) => reject(new Error(`${script}: ${e.message}`));
    w.addEventListener('message', ({ data }) => {
      if (data.ready) resolve({ w, version: data.version, zxcVersion: data.zxcVersion, hevc: data.hevc, opus: data.opus,
                                post: (m, t) => w.postMessage(m, t),
                                onMessage: (cb) => w.addEventListener('message', ({ data: d }) => cb(d)) });
    }, { once: true });
  })));
}

// nights-nx-installer (2026-11-22, the template's way, sa2-nx-ult-installer's worker.js): one kind of worker as
// { run, version, stop() }.
async function tool(script, count, wrap) {
  const workers = await startWorkers(script, count);
  return { run: wrap(workerPool(workers)), version: workers[0].version, zxcVersion: workers[0].zxcVersion,
           hevc: workers[0].hevc, opus: workers[0].opus, size: workers.length,
           stop: () => workers.forEach((x) => x.w.terminate()) };
}

// game.json's patterns: case-insensitive regular expressions on a file's path in the game folder.
const patterns = (list) => (list || []).map((p) => new RegExp(`^(?:${p})$`, 'i'));
const matches = (res, path) => res.some((re) => re.test(path));

// culdcept-nx-installer (2026-11-20): jobs for `list`'s files started ahead of the zip, at most `window` at a time
// (each holds its file's bytes until the zip takes its result): path -> promise of start(file).
function jobsAhead(list, window, start) {
  const jobs = new Map();
  let next = 0, inFlight = 0;
  const launch = () => {
    while (inFlight < window && next < list.length) {
      const f = list[next++];
      ++inFlight;
      jobs.set(f.path, start(f).finally(() => { --inFlight; launch(); }));
    }
  };
  launch();
  return jobs;
}

// game.json "audio" "bitrates": [{ match, stereo, mono }], the first rule matching the path (bit/s).
function audioBitrates(rules, path) {
  for (const r of rules) if (new RegExp(`^(?:${r.match})$`, 'i').test(path)) return { stereo: r.stereo, mono: r.mono };
  return { stereo: 128000, mono: 48000 };
}

self.onmessage = async ({ data }) => {
  const sink = portSink(data.port);
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 1000);
  let workers = [];
  const stopWorkers = () => { for (const x of workers) x.w.terminate(); workers = []; };
  let stopPools = () => {};  // the packing, movie and audio workers (set once they start)
  try {
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('./release/manifest.json')));
    const files = await gameFiles(data.input);
    const xex = files.find((f) => f.path === 'default.xex');
    if (!xex) throw new Error('no default.xex: choose the game\'s package, or the folder it was extracted to');
    const xexBytes = await readWhole(xex);
    const xexHash = await sha256(xexBytes);
    const build = manifest.builds.find((b) => b.xex_sha256 === xexHash);
    if (!build) throw new Error(`this default.xex is not one this release supports (SHA-256 ${xexHash})`);
    const xexp = files.find((f) => f.path === 'default.xexp');
    if (!xexp) throw new Error('the title update is missing: add its package (or its default.xexp)');
    const xexpHash = await sha256(await readWhole(xexp));
    if (build.xexp_sha256 && xexpHash !== build.xexp_sha256) {
      throw new Error(`this title update is not the one the program was made for (default.xexp SHA-256 ${xexpHash})`);
    }

    log('Downloading the program and the tools...');
    const [nro, variantsText, shaderCommon] = await Promise.all([
      fetchChecked(build.nro, build.nro_sha256),
      fetchBytes('./release/variants.txt').then((b) => new TextDecoder().decode(b)),
      fetchBytes('./release/shader_common.h'),
    ]);
    const extras = await Promise.all(build.files.map(async (f) => ({ ...f, bytes: await fetchChecked(f.source, f.sha256) })));
    const tr = await createRenutHlslModule(quiet());
    const lzx = await createLzxModule(quiet());
    log(`Tools ready (${seconds()} s). Looking for the shaders in the game's files...`);

    // 1. the shaders' containers: the executable's image and shader/xbox 360/ (lib/nights_dump.js)
    const { image } = await readXexImage(xexBytes, lzxStep(lzx));
    const seen = new Set();
    const containers = [];
    const add = async (c) => {
      const h = await sha256(c);
      if (!seen.has(h)) { seen.add(h); containers.push(c); }
    };
    for (const c of imageContainers(image)) await add(c);
    const shaderFiles = files.filter((f) => isShaderFile(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
    for (const f of shaderFiles) {
      const c = fileContainer(await readWhole(f));
      if (c) await add(c);
    }
    progress('dump')(1);
    log(`${containers.length} shaders found`);

    // 2-4. the shaders' GLSL and the shader table. A GLSL worker (Pyodide, numpy, DXC) holds about 0.5 GB: at most 8 of
    // them, fewer on a device with less memory (navigator.deviceMemory, in GB, Chromium only). A uam worker is small:
    // one per core.
    const cores = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
    const glslThreads = Math.max(1, Math.min(cores, 8, navigator.deviceMemory || 8));
    log(`Making the shaders' GLSL on ${glslThreads} threads...`);
    workers = await startWorkers('./glsl_worker.js', glslThreads);
    const errors = [];
    const { shaders, failed } = await makeGlsl(containers, tr, glslMaker(workerPool(workers)), shaderCommon, log,
                                               progress('glsl'), (e) => errors.push(e));
    stopWorkers();
    if (failed) throw new Error(`${failed} shaders could not be made: ${errors.slice(0, 3).join('; ')}`);
    const glslPackage = packageShaders(shaders);

    // 5: every variant the game uses, compiled for the console (and the NRO's own shaders' variants, if it has any)
    const glslOf = new Map(shaders.map((s) => [s.name, s.glsl]));
    for (const [stem, glsl] of nroShaders(nro)) if (!glslOf.has(stem)) glslOf.set(stem, glsl);
    const { jobs } = variantJobs(parseVariants(variantsText), glslOf);
    log(`Compiling ${jobs.length} shader variants for the Switch on ${cores} threads...`);
    workers = await startWorkers('./uam_worker.js', cores);
    const { cache, failures } = await compileVariants(jobs, uamCompile(workerPool(workers)), cores * 2, progress('uam'));
    stopWorkers();
    if (failures.length) throw new Error(`${failures.length} shader variants did not compile: ${failures[0].error.slice(0, 200)}`);
    const glslHash = await sha256(glslPackage), cacheHash = await sha256(cache);
    const checked = build.deko3d_glsl_sha256 === glslHash && build.deko3d_shaders_sha256 === cacheHash;
    log(`Shaders done in ${seconds()} s: ${shaders.length} shaders, ${jobs.length} variants` +
        (build.deko3d_glsl_sha256 ? (checked ? ', identical to the release\'s reference build' : ' (NOT the reference build\'s: ' +
          `${glslHash.slice(0, 12)} / ${cacheHash.slice(0, 12)})`) : ''));

    // the zip: the program, its files, the shaders, and the game's files (renut.toml is not in it: the program writes
    // it at its first start, so an update never overwrites your settings).
    //
    // nights-nx-installer (2026-11-22, the user: "help nights into dreams have l4z and zxc in its web installer and
    // rencode video and audio to opus and h265", "also make sure nights ZXC compresses its videos"; the template's
    // lib/install.js as culdcept-nx-installer and sa2-nx-ult-installer have it), by game.json:
    //   - "zxc" (ZXC 7, 512 KB blocks: the stages' .ddm, the .bin archives, the sound banks, the .dat files) and "lz4"
    //     (LZ4 HC 9, 256 KB blocks: the rest but default.xex(p), the movies and the music) as NAME.lz4b, which nights-nx
    //     reads as NAME (rr6-nx's reader, sdk/include/rex/filesystem/lz4_blocks.h). On NiGHTS's files ZXC is smaller
    //     for all but the tiny .csa ones (1,093 MB: LZ4 330, ZXC 312 MB);
    //   - "movies" (afs/*.wmv, VC-1) re-encoded to H.265 (movie_worker.js, lib/movies.js) and packed as ZXC blocks
    //     (NAME.wmv.lz4b); a movie the browser cannot re-encode goes in as it is (and is packed as LZ4 by nothing: it
    //     stays NAME.wmv);
    //   - "audio" (afs/*.adx) re-encoded to Opus (audio_worker.js, lib/audio.js) as NAME.adxo, which nights-nx plays
    //     through its ADX decoder hook (app/src/nights_adx_opus.cpp); not packed (Opus does not compress).
    // The zip's size is known only at the end.
    const gameJson = JSON.parse(new TextDecoder().decode(await fetchBytes('./game.json')));
    const lz4 = patterns(gameJson.lz4), zxc = patterns(gameJson.zxc), skip = patterns(gameJson.skip);
    const codecOf = (path) => (matches(zxc, path) ? 'zxc' : matches(lz4, path) ? 'lz4' : null);
    const gameList = files.filter((f) => !matches(skip, f.path));
    const running = [];
    const stopTools = () => { for (const r of running.splice(0)) r.stop(); };
    stopPools = stopTools;
    const packPool = await tool('./pack_worker.js', cores, (pool) => (bytes, codec) =>
      pool.run({ bytes, codec, level: CODECS[codec].level, block: CODECS[codec].block }, [bytes.buffer]).then((r) => r.bytes));
    running.push(packPool);
    {
      const version = (v) => `${Math.floor(v / 10000)}.${Math.floor(v / 100) % 100}.${v % 100}`;
      const n = (codec) => gameList.filter((f) => codecOf(f.path) === codec).length;
      log(`LZ4 ${version(packPool.version)} for ${n('lz4')} files and ZXC ${version(packPool.zxcVersion)} for ${n('zxc')} ` +
          `on ${cores} threads.`);
    }
    let movieJobs = new Map();
    if (data.movies !== false && gameJson.movies) {
      const list = gameList.filter((f) => matches(patterns([gameJson.movies.match]), f.path));
      if (list.length) {
        const moviePool = await tool('./movie_worker.js', Math.max(1, Math.min(4, cores >> 1)), (pool) => (bytes, opts) =>
          pool.run({ bytes, ...opts }, [bytes.buffer]));
        running.push(moviePool);
        if (!moviePool.hevc) {
          log('This browser cannot encode H.265 (WebCodecs with the computer\'s video hardware): the movies stay as they are.');
        } else {
          log(`Re-encoding ${list.length} movies to H.265 (${Math.round((gameJson.movies.fraction || 0.35) * 100)} % of ` +
              `their bitrate) on ${moviePool.size} workers, with this computer's video encoder.`);
          movieJobs = jobsAhead(list, moviePool.size * 2, (f) => f.read(0, f.size).then((bytes) =>
            moviePool.run(bytes, { fraction: gameJson.movies.fraction, gop: gameJson.movies.gop })));
        }
      }
    }
    let audioJobs = new Map();
    if (data.audio !== false && gameJson.audio) {
      const list = gameList.filter((f) => matches(patterns([gameJson.audio.match]), f.path));
      if (list.length) {
        const audioPool = await tool('./audio_worker.js', Math.max(1, Math.min(8, cores)), (pool) => (bytes, opts) =>
          pool.run({ bytes, ...opts }, [bytes.buffer]));
        running.push(audioPool);
        if (!audioPool.opus) {
          log('This browser cannot encode Opus (WebCodecs): the music stays ADX.');
        } else {
          const rules = gameJson.audio.bitrates || [{ match: '.*', stereo: 128000, mono: 48000 }];
          log(`Re-encoding ${list.length} music files to Opus on ${audioPool.size} workers.`);
          audioJobs = jobsAhead(list, audioPool.size * 2, (f) => f.read(0, f.size).then((bytes) =>
            audioPool.run(bytes, { bitrates: audioBitrates(rules, f.path) })));
        }
      }
    }

    const totalIn = nro.length + extras.reduce((n, f) => n + f.bytes.length, 0) + glslPackage.length + cache.length +
                    gameList.reduce((n, f) => n + f.size, 0);
    postMessage({ type: 'size', size: null });
    const zip = new ZipWriter(sink);
    let written = 0;
    const counted = (n) => { written += n; progress('zip')(written / totalIn); };
    await zip.addBytes(`${ROOT}/nights-nx.nro`, nro); counted(nro.length);
    for (const f of extras) { await zip.addBytes(`${ROOT}/${f.path}`, f.bytes); counted(f.bytes.length); }
    await zip.addBytes(`${ROOT}/deko3d_glsl.bin`, glslPackage); counted(glslPackage.length);
    await zip.addBytes(`${ROOT}/deko3d_shaders.bin`, cache); counted(cache.length);
    const stats = { packedIn: 0, packedOut: 0, moviesIn: 0, moviesOut: 0, audioIn: 0, audioOut: 0, audioKept: 0 };
    const mb = (n) => (n / 1048576).toFixed(1);
    for (const f of gameList) {
      const at = `${ROOT}/game_root/${f.path}`;
      if (movieJobs.has(f.path)) {
        const r = await movieJobs.get(f.path);
        movieJobs.delete(f.path);
        if (r.bytes) {
          const asFile = { size: r.bytes.length, read: async (o, n) => r.bytes.subarray(o, o + n) };
          const size = await zip.addStream(`${at}${SUFFIX}`, pack(asFile, packPool.run, { codec: 'zxc', inFlight: cores * 4 }));
          counted(f.size);
          stats.moviesIn += f.size;
          stats.moviesOut += size;
          log(`  ${f.path}: H.265, ${mb(f.size)} MB -> ${mb(size)} MB (${r.kbps} kbit/s, ${r.pictures} pictures)`);
        } else {
          log(`  ${f.path}: kept as it is (${r.why})`);
          await zip.addFile(at, f.size, chunks(f), (c) => counted(c.length));
        }
      } else if (audioJobs.has(f.path)) {
        const r = await audioJobs.get(f.path);
        audioJobs.delete(f.path);
        if (r.bytes) {
          await zip.addBytes(`${at}.adxo`, r.bytes);
          counted(f.size);
          stats.audioIn += f.size;
          stats.audioOut += r.bytes.length;
        } else {
          ++stats.audioKept;
          if (stats.audioKept <= 5) log(`  ${f.path}: kept as ADX (${r.why})`);
          await zip.addFile(at, f.size, chunks(f), (c) => counted(c.length));
        }
      } else if (codecOf(f.path)) {
        const codec = codecOf(f.path);
        const size = await zip.addStream(`${at}${SUFFIX}`,
                                         pack(f, packPool.run, { codec, inFlight: cores * 4, onRaw: counted }));
        stats.packedIn += f.size;
        stats.packedOut += size;
      } else {
        await zip.addFile(at, f.size, chunks(f), (c) => counted(c.length));
      }
    }
    const zipBytes = await zip.finish();
    stopTools();
    if (stats.packedIn) {
      log(`Packed ${mb(stats.packedIn)} MB of game files to ${mb(stats.packedOut)} MB (LZ4 and ZXC).`);
    }
    if (stats.moviesIn) log(`Movies: ${mb(stats.moviesIn)} MB of VC-1 as ${mb(stats.moviesOut)} MB of H.265 (ZXC-packed).`);
    if (stats.audioIn) {
      log(`Music: ${mb(stats.audioIn)} MB of ADX as ${mb(stats.audioOut)} MB of Opus` +
          (stats.audioKept ? `; ${stats.audioKept} files kept as ADX.` : '.'));
    }
    postMessage({ type: 'done', seconds: seconds(), size: zipBytes });
  } catch (error) {
    stopPools();
    stopWorkers();
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};
