// Glasses writes race if overlapped. One in flight, each with a timeout,
// and "latest wins" per key so a slow BLE link never builds a backlog.

export function createWriteQueue(timeoutMs = 4000) {
  const pending = new Map<string, () => Promise<unknown>>();
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      while (pending.size) {
        const [key, job] = pending.entries().next().value as [string, () => Promise<unknown>];
        pending.delete(key);
        try {
          await Promise.race([job(), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${key}`)), timeoutMs))]);
        } catch (err) {
          console.warn('[hud] write failed', key, err);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    push(key: string, job: () => Promise<unknown>) {
      pending.delete(key);
      pending.set(key, job);
      void drain();
    },
    get size() { return pending.size; },
  };
}
