import { randomId } from "../identity.mjs";

const DEFAULT_TOKEN_TTL_MS = 60_000;
const DEFAULT_CLOSE_TOKEN_TTL_MS = 30_000;
const DEFAULT_LEASE_MS = 10 * 60_000;
const DEFAULT_RENEW_MS = 60_000;
const MAX_ADOPTION_TOKENS = 256;
const MAX_CLOSE_TOKENS = 128;

function createAdoptionRuntime(options = {}) {
  const handlers = { renew: null, dispose: null };
  const state = {
    runtime_id: String(options.runtime_id ?? randomId("runtime")),
    adoptionTokens: new Map(),
    closeTokens: new Map(),
    disposed: false,
    renewalTimer: null,
    now: typeof options.now === "function" ? options.now : Date.now,
    getRuntime: typeof options.get_runtime === "function" ? options.get_runtime : () => null,
    token_ttl_ms: Math.max(1, Number(options.token_ttl_ms ?? DEFAULT_TOKEN_TTL_MS)),
    close_token_ttl_ms: Math.max(1, Number(options.close_token_ttl_ms ?? DEFAULT_CLOSE_TOKEN_TTL_MS)),
    lease_ms: Math.max(1, Number(options.lease_ms ?? DEFAULT_LEASE_MS)),
    renew_ms: Math.max(1, Number(options.renew_ms ?? DEFAULT_RENEW_MS)),
    max_adoption_tokens: Math.max(1, Number(options.max_adoption_tokens ?? MAX_ADOPTION_TOKENS)),
    max_close_tokens: Math.max(1, Number(options.max_close_tokens ?? MAX_CLOSE_TOKENS)),
    putAdoptionToken(token, entry) {
      while (state.adoptionTokens.size >= state.max_adoption_tokens) {
        state.adoptionTokens.delete(state.adoptionTokens.keys().next().value);
      }
      state.adoptionTokens.set(token, entry);
      return entry;
    },
    putCloseToken(token, entry) {
      while (state.closeTokens.size >= state.max_close_tokens) {
        state.closeTokens.delete(state.closeTokens.keys().next().value);
      }
      state.closeTokens.set(token, entry);
      return entry;
    },
    configure(next = {}) {
      if (state.disposed) throw new Error(`adoption runtime ${state.runtime_id} is disposed`);
      if (typeof next.renew === "function") handlers.renew = next.renew;
      if (typeof next.dispose === "function") handlers.dispose = next.dispose;
      if (options.start_timer !== false && !state.renewalTimer && handlers.renew) {
        state.renewalTimer = setInterval(() => {
          Promise.resolve(handlers.renew?.(state)).catch(() => {});
        }, state.renew_ms);
        state.renewalTimer.unref?.();
      }
      return state;
    },
    stats() {
      return {
        runtime_id: state.runtime_id,
        disposed: state.disposed,
        adoption_token_count: state.adoptionTokens.size,
        close_token_count: state.closeTokens.size,
        max_adoption_tokens: state.max_adoption_tokens,
        max_close_tokens: state.max_close_tokens,
        renewal_active: Boolean(state.renewalTimer),
      };
    },
    async dispose() {
      if (state.disposed) return [];
      let released = [];
      try {
        if (handlers.dispose) released = await handlers.dispose(state);
      } finally {
        state.disposed = true;
        if (state.renewalTimer) clearInterval(state.renewalTimer);
        state.renewalTimer = null;
        state.adoptionTokens.clear();
        state.closeTokens.clear();
      }
      return released;
    },
  };
  return state;
}

export {
  DEFAULT_CLOSE_TOKEN_TTL_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_RENEW_MS,
  DEFAULT_TOKEN_TTL_MS,
  MAX_ADOPTION_TOKENS,
  MAX_CLOSE_TOKENS,
  createAdoptionRuntime,
};
