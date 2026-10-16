// Starts the simulation somewhere off the page's own thread if it can.
//  1. The built single-file page carries the worker's code as a string
//     (window.__RNA_WORKER_SRC) and starts it from a Blob URL.
//  2. Served from the repo, it starts src/sim/worker.js as a module worker.
//  3. If neither works (a locked-down frame), the same server runs on the
//     main thread, sliced so the page stays responsive.

import { createSimServer } from '../sim/worker.js';

function tryWorker(make, onMessage) {
  return new Promise((resolve) => {
    let w;
    try {
      w = make();
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      w.terminate();
      resolve(null);
    }, 4000);
    w.onerror = () => {
      clearTimeout(timer);
      w.terminate();
      resolve(null);
    };
    w.onmessage = (e) => {
      if (e.data?.type === 'pong') {
        clearTimeout(timer);
        w.onmessage = (ev) => onMessage(ev.data);
        w.onerror = null;
        resolve(w);
      }
    };
    w.postMessage({ type: 'ping' });
  });
}

export async function createHost(onMessage, { prefer = 'worker' } = {}) {
  if (prefer === 'worker' && typeof Worker !== 'undefined') {
    let w = null;
    if (typeof window !== 'undefined' && window.__RNA_WORKER_SRC) {
      w = await tryWorker(() => new Worker(URL.createObjectURL(new Blob([window.__RNA_WORKER_SRC], { type: 'text/javascript' }))), onMessage);
    } else {
      w = await tryWorker(() => new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' }), onMessage);
    }
    if (w) return { kind: 'worker', send: (m) => w.postMessage(m), terminate: () => w.terminate() };
  }
  // Main thread: the server's replies are delivered asynchronously so the
  // calling code behaves the same as with a worker.
  const handle = createSimServer((msg) => setTimeout(() => onMessage(msg), 0));
  return { kind: 'main', send: (m) => handle(m), terminate: () => handle({ type: 'run', running: false }) };
}
