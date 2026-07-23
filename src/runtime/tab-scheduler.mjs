/**
 * @typedef {{ dispose(): Promise<void>, run<T>(key: unknown, callback: () => Promise<T> | T): Promise<T>, stats(): object }} TabScheduler
 */

const DEFAULT_MAX_SCHEDULER_KEYS = 512;
const DEFAULT_MAX_QUEUE_PER_KEY = 64;

/** @returns {TabScheduler} */
function createTabScheduler(options = {}) {
  const maxKeys = Math.max(1, Number(options.max_keys ?? DEFAULT_MAX_SCHEDULER_KEYS));
  const maxQueuePerKey = Math.max(1, Number(options.max_queue_per_key ?? DEFAULT_MAX_QUEUE_PER_KEY));
  const tails = new Map();
  const activeByKey = new Map();
  const queuedByKey = new Map();
  let disposed = false;

  /**
   * @template T
   * @param {unknown} key
   * @param {() => Promise<T> | T} callback
   * @returns {Promise<T>}
   */
  async function run(key, callback) {
    if (disposed) {
      throw new Error("tab scheduler is disposed");
    }
    const normalizedKey = String(key || "runtime");
    if (!queuedByKey.has(normalizedKey) && queuedByKey.size >= maxKeys) {
      throw new Error(`tab scheduler key limit reached (${String(maxKeys)})`);
    }
    const queued = queuedByKey.get(normalizedKey) ?? 0;
    if (queued >= maxQueuePerKey) {
      throw new Error(`tab scheduler queue limit reached key=${normalizedKey} max=${String(maxQueuePerKey)}`);
    }
    queuedByKey.set(normalizedKey, queued + 1);
    const previous = tails.get(normalizedKey) ?? Promise.resolve();
    /** @type {(() => void) | undefined} */
    let release;
    const current = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const tail = previous.catch(() => {}).then(() => current);
    tails.set(normalizedKey, tail);
    await previous.catch(() => {});
    activeByKey.set(normalizedKey, (activeByKey.get(normalizedKey) ?? 0) + 1);
    try {
      return await callback();
    } finally {
      const active = Math.max(0, (activeByKey.get(normalizedKey) ?? 1) - 1);
      if (active === 0) {
        activeByKey.delete(normalizedKey);
      } else {
        activeByKey.set(normalizedKey, active);
      }
      release?.();
      if (tails.get(normalizedKey) === tail) {
        tails.delete(normalizedKey);
      }
      const remainingQueued = Math.max(0, (queuedByKey.get(normalizedKey) ?? 1) - 1);
      if (remainingQueued === 0) queuedByKey.delete(normalizedKey);
      else queuedByKey.set(normalizedKey, remainingQueued);
    }
  }

  function stats() {
    return {
      disposed,
      queued_key_count: tails.size,
      active_key_count: activeByKey.size,
      active_by_key: Object.fromEntries(activeByKey),
      queued_request_count: [...queuedByKey.values()].reduce((sum, count) => sum + count, 0),
      max_keys: maxKeys,
      max_queue_per_key: maxQueuePerKey,
    };
  }

  async function dispose() {
    disposed = true;
    await Promise.allSettled([...tails.values()]);
    tails.clear();
    activeByKey.clear();
    queuedByKey.clear();
  }

  return Object.freeze({ dispose, run, stats });
}

export {
  DEFAULT_MAX_QUEUE_PER_KEY,
  DEFAULT_MAX_SCHEDULER_KEYS,
  createTabScheduler,
};
