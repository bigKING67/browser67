/**
 * @typedef {{ dispose(): Promise<void>, run<T>(key: unknown, callback: () => Promise<T> | T): Promise<T>, stats(): object }} TabScheduler
 */

/** @returns {TabScheduler} */
function createTabScheduler() {
  const tails = new Map();
  const activeByKey = new Map();
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
    }
  }

  function stats() {
    return {
      disposed,
      queued_key_count: tails.size,
      active_key_count: activeByKey.size,
      active_by_key: Object.fromEntries(activeByKey),
    };
  }

  async function dispose() {
    disposed = true;
    await Promise.allSettled([...tails.values()]);
    tails.clear();
    activeByKey.clear();
  }

  return Object.freeze({ dispose, run, stats });
}

export { createTabScheduler };
