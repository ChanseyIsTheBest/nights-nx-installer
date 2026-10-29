// banjo-nx-installer: jobs on several workers (Pyodide, DXC and uam are single threaded: one instance per worker).
// workers: objects with post(message, transfer) and onMessage(callback), over Web Workers (the page) or
// worker_threads (the Node tests). A worker answers { id, ... } to { id, ... } (glsl_worker.js, uam_worker.js).
export function workerPool(workers) {
  const pending = new Map();
  const load = workers.map(() => 0);
  let nextId = 0;
  workers.forEach((w, i) => w.onMessage((reply) => {
    if (reply.id === undefined) return;  // the worker's "ready"
    load[i]--;
    const resolve = pending.get(reply.id);
    pending.delete(reply.id);
    resolve(reply);
  }));
  return {
    size: workers.length,
    run(message, transfer = []) {
      let best = 0;
      for (let i = 1; i < load.length; ++i) if (load[i] < load[best]) best = i;
      load[best]++;
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        workers[best].post({ ...message, id }, transfer);
      });
    },
  };
}

// uam_worker.js's jobs: compile(stage, text) -> { dksh } or { error }
export const uamCompile = (pool) => (stage, text) => pool.run({ stage, text })
  .then((r) => (r.error !== undefined ? { error: r.error } : { dksh: r.dksh }));

// glsl_worker.js's jobs: glsl(name, hlsl) -> UTF-8 GLSL, or throws
export const glslMaker = (pool) => (name, hlsl) => pool.run({ name, hlsl }).then((r) => {
  if (r.error !== undefined) throw new Error(r.error);
  return r.glsl;
});
