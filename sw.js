// banjo-nx-installer: serves the zip the page makes as a normal browser download, streamed while it is being made.
// The download part of bejeweled3-nx-installer's sw.js (from nfsmw-nx-installer's, StevensND, GPL-3.0); the prototype
// does not keep an offline copy of the page. The worker sends the zip through a MessagePort, one chunk per "pull", so
// memory use stays bounded however big the zip is (the game alone is 6 GB).
const jobs = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'download') {
    const [port, ack] = event.ports;
    jobs.set(data.id, { port, size: data.size, filename: data.filename });
    ack.postMessage('registered');
  } else if (data.type === 'claim') {
    event.waitUntil(self.clients.claim());
  }
  // "ping" messages only keep this worker alive while a download is running.
});

self.addEventListener('fetch', (event) => {
  const match = /\/download\/([\w-]+)\/[^/]+$/.exec(new URL(event.request.url).pathname);
  if (!match) return;
  const job = jobs.get(match[1]);
  if (!job) return;
  jobs.delete(match[1]);
  event.respondWith(serveDownload(job));
});

function serveDownload(job) {
  const { port } = job;
  const stream = new ReadableStream(
    {
      start(controller) {
        port.onmessage = ({ data }) => {
          if (data.type === 'chunk') controller.enqueue(new Uint8Array(data.buffer));
          else if (data.type === 'end') controller.close();
          else if (data.type === 'error') controller.error(new Error(data.message));
        };
      },
      pull() {
        port.postMessage({ type: 'pull' });
      },
      cancel() {
        port.postMessage({ type: 'cancel' });
      },
    },
    { highWaterMark: 4 },
  );
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${job.filename}"`,
      'Content-Length': String(job.size),
    },
  });
}
