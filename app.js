// nights-nx-installer: the page. The player chooses their two Xbox 360 packages (the game and its title update, read in
// place by lib/stfs.js) or the folder the game was extracted to; worker.js makes the Switch package from them (the
// shaders included: the NRO carries none of the game's) and sw.js serves it as a download.
// From banjo-nx-installer's app.js (bejeweled3-nx-installer's, ChanseyIsTheBest; nfsmw-nx-installer's download flow,
// StevensND; GPL-3.0).
import { readStfsHeader } from './lib/stfs.js';

const GAME_TITLE = 0x58411268;
const CONTENT_GAME = 0x000d0000, CONTENT_UPDATE = 0x000b0000;
const folderInput = document.getElementById('folder');
const packagesInput = document.getElementById('packages');
const chosen = document.getElementById('chosen');
const detected = document.getElementById('detected');
const create = document.getElementById('create');
const bar = document.getElementById('bar');
const logBox = document.getElementById('log');
const manifest = fetch('./release/manifest.json').then((r) => r.json());
let input = null;
let busy = false;
let downloadFrame = null;

function log(text, error = false) {
  const line = document.createElement('div');
  line.textContent = text;
  if (error) line.className = 'error';
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

function formatSize(bytes) {
  return bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(2)} GB` : `${(bytes / (1 << 20)).toFixed(0)} MB`;
}

async function sha256(blob) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

function show(state, text) {
  detected.hidden = false;
  detected.className = `detected ${state}`;
  detected.textContent = text;
}

function refuse(text) {
  input = null;
  create.disabled = true;
  show('bad', text);
}

// The extracted folder: default.xex is checked here (the packages' is checked by the worker, which reads them).
folderInput.addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  // the paths inside the chosen folder (its own name dropped)
  const list = files.map((file) => ({ path: file.webkitRelativePath.split('/').slice(1).join('/'), size: file.size, file }));
  input = null;
  create.disabled = true;
  chosen.textContent = `${files[0].webkitRelativePath.split('/')[0]}: ${list.length} files, ` +
                       formatSize(list.reduce((n, e) => n + e.size, 0));
  const xex = list.find((e) => e.path === 'default.xex');
  if (!xex) return refuse('No default.xex: choose the folder the game was extracted to.');
  if (!list.some((e) => e.path === 'default.xexp')) {
    return refuse('No default.xexp: put the title update\'s default.xexp beside default.xex.');
  }
  show('', 'Checking default.xex...');
  const hash = await sha256(xex.file);
  const build = (await manifest).builds.find((b) => b.xex_sha256 === hash);
  if (!build) return refuse(`This default.xex is not one this release supports. Its SHA-256: ${hash}`);
  show('good', `NiGHTS into Dreams... (${build.edition}), supported.`);
  input = { folder: list };
  create.disabled = busy;
});

// The packages: the game's and its update's, recognised by their headers.
packagesInput.addEventListener('change', async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  input = null;
  create.disabled = true;
  chosen.textContent = files.map((f) => `${f.name} (${formatSize(f.size)})`).join(', ');
  let game = 0, update = 0;
  for (const file of files) {
    if (file.name.toLowerCase() === 'default.xexp') { update++; continue; }
    const header = readStfsHeader(new Uint8Array(await file.slice(0, 0x600).arrayBuffer()));
    if (!header) return refuse(`${file.name} is not an Xbox 360 content package.`);
    if (header.titleId !== GAME_TITLE) {
      return refuse(`${file.name} is "${header.displayName}" (title ${header.titleId.toString(16).toUpperCase()}), ` +
                    'not NiGHTS into Dreams... (58411268).');
    }
    if (header.contentType === CONTENT_GAME) game++;
    else if (header.contentType === CONTENT_UPDATE) update++;
    else return refuse(`${file.name} is neither the game nor its title update.`);
  }
  if (game !== 1) return refuse(game ? 'Choose one game package, not several.' : 'The game\'s package is missing: choose it together with the update.');
  if (update !== 1) return refuse(update ? 'Choose one title update, not several.' : 'The title update is missing: choose it together with the game.');
  show('good', 'NiGHTS into Dreams... and its title update. default.xex is checked when the package is made.');
  input = { packages: files };
  create.disabled = busy;
});

// The zip is served by sw.js as a normal browser download, streamed while it is being made.
async function downloadHelper() {
  if (!('serviceWorker' in navigator)) throw new Error('this browser cannot stream a download (no service workers)');
  await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    const claimed = new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    registration.active.postMessage({ type: 'claim' });
    await claimed;
  }
  return navigator.serviceWorker.controller;
}
const helper = downloadHelper();
helper.catch(() => {});

create.addEventListener('click', async () => {
  if (!input || busy) return;
  let controller;
  try {
    controller = await helper;
  } catch (error) {
    log(`Error: ${error.message}`, true);
    return;
  }
  busy = true;
  create.disabled = true;
  bar.hidden = false;
  bar.value = 0;
  logBox.textContent = '';
  const channel = new MessageChannel();
  const keepAlive = setInterval(() => controller.postMessage({ type: 'ping' }), 10000);
  const worker = new Worker('./worker.js', { type: 'module' });
  const finish = () => {
    clearInterval(keepAlive);
    worker.terminate();
    busy = false;
    create.disabled = !input;
  };
  worker.onmessage = async ({ data }) => {
    if (data.type === 'log') {
      log(data.text);
    } else if (data.type === 'progress') {
      bar.value = data.fraction;
    } else if (data.type === 'size') {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ack = new MessageChannel();
      const registered = new Promise((resolve) => (ack.port1.onmessage = resolve));
      controller.postMessage({ type: 'download', id, filename: 'nights-nx.zip', size: data.size }, [channel.port2, ack.port2]);
      await registered;
      // a hidden frame opens the download: its request is a navigation, which always reaches the service worker
      downloadFrame?.remove();
      downloadFrame = document.createElement('iframe');
      downloadFrame.hidden = true;
      downloadFrame.src = `./download/${id}/nights-nx.zip`;
      document.body.appendChild(downloadFrame);
      log(`Download started: nights-nx.zip, ${formatSize(data.size)}. Keep this page open until it finishes.`);
    } else if (data.type === 'done') {
      bar.value = 1;
      log(`Finished in ${data.seconds} s.`);
      finish();
    } else if (data.type === 'error') {
      log(`Error: ${data.message}`, true);
      finish();
    }
  };
  worker.onerror = (event) => {
    log(`Error: ${event.message}`, true);
    finish();
  };
  worker.postMessage({ input, port: channel.port1 }, [channel.port1]);
});
