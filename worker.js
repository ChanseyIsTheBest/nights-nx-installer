// nights-nx-installer: makes the package off the page's thread and streams the zip to the download service worker
// (sw.js). From banjo-nx-installer's worker.js (its shader build, lib/build.js, unchanged), with futari-nx-installer's
// XEX and STFS readers (sa2-nx-installer's) for NiGHTS's Xbox Live Arcade packages, and NiGHTS's own shader dump
// (lib/nights_dump.js) in place of Nuts & Bolts' bundle reader. GPL-3.0.
import createRenutHlslModule from './wasm/renut_hlsl.mjs';
import createLzxModule from './wasm/lzx.mjs';
import { compileVariants, makeGlsl, packageShaders, variantJobs } from './lib/build.js';
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
      if (data.ready) resolve({ w, post: (m, t) => w.postMessage(m, t), onMessage: (cb) => w.addEventListener('message', ({ data: d }) => cb(d)) });
    }, { once: true });
  })));
}

self.onmessage = async ({ data }) => {
  const sink = portSink(data.port);
  const started = performance.now();
  const seconds = () => Math.round((performance.now() - started) / 1000);
  let workers = [];
  const stopWorkers = () => { for (const x of workers) x.w.terminate(); workers = []; };
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
    // it at its first start, so an update never overwrites your settings)
    const entries = [
      { path: `${ROOT}/nights-nx.nro`, size: nro.length },
      ...extras.map((f) => ({ path: `${ROOT}/${f.path}`, size: f.bytes.length })),
      { path: `${ROOT}/deko3d_glsl.bin`, size: glslPackage.length },
      { path: `${ROOT}/deko3d_shaders.bin`, size: cache.length },
      ...files.map((f) => ({ path: `${ROOT}/game_root/${f.path}`, size: f.size })),
    ];
    const total = zipSize(entries);
    postMessage({ type: 'size', size: total });
    const zip = new ZipWriter(sink);
    let written = 0;
    const counted = (n) => { written += n; progress('zip')(written / total); };
    await zip.addBytes(entries[0].path, nro); counted(nro.length);
    for (const f of extras) { await zip.addBytes(`${ROOT}/${f.path}`, f.bytes); counted(f.bytes.length); }
    await zip.addBytes(`${ROOT}/deko3d_glsl.bin`, glslPackage); counted(glslPackage.length);
    await zip.addBytes(`${ROOT}/deko3d_shaders.bin`, cache); counted(cache.length);
    for (const f of files) {
      await zip.addFile(`${ROOT}/game_root/${f.path}`, f.size, chunks(f), (c) => counted(c.length));
    }
    await zip.finish();
    postMessage({ type: 'done', seconds: seconds() });
  } catch (error) {
    stopWorkers();
    const message = error.message || String(error);
    sink.fail(message);
    postMessage({ type: 'error', message });
  }
};
