import {
  normalizeTmwdLinkEndpoint,
  normalizeTmwdWsEndpoint,
} from "../runtime/config/endpoints.mjs";

const MAX_ENDPOINT_HEALTH_RECORDS = 32;

function endpointFor(args, transport) {
  return transport === "ws"
    ? normalizeTmwdWsEndpoint(args?.tmwd_ws_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_WS_ENDPOINT)
    : normalizeTmwdLinkEndpoint(args?.tmwd_link_endpoint ?? process.env.BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT);
}

function healthKey(transport, endpoint) {
  return `${transport}:${endpoint}`;
}

function createTmwdTransportHealthStore(options = {}) {
  const maxRecords = Math.max(1, Number(options.max_records ?? MAX_ENDPOINT_HEALTH_RECORDS));
  const endpointHealth = new Map();

  function ensureBound() {
    while (endpointHealth.size > maxRecords) {
      const oldest = [...endpointHealth.entries()]
        .sort((left, right) => Number(left[1].updated_at_ms) - Number(right[1].updated_at_ms))[0];
      if (!oldest) return;
      endpointHealth.delete(oldest[0]);
    }
  }

  function record(args, transport, ok, recordOptions = {}) {
    const endpoint = recordOptions.endpoint || endpointFor(args, transport);
    const key = healthKey(transport, endpoint);
    const now = Date.now();
    const prior = endpointHealth.get(key) ?? {
      transport,
      endpoint,
      consecutive_failures: 0,
      last_success_at_ms: 0,
      last_failure_at_ms: 0,
      retry_after_ms: 0,
      updated_at_ms: 0,
    };
    const next = ok
      ? {
        ...prior,
        consecutive_failures: 0,
        last_success_at_ms: now,
        retry_after_ms: 0,
        last_error: "",
        updated_at_ms: now,
      }
      : (() => {
        const failures = prior.consecutive_failures + 1;
        const backoffMs = Math.min(5_000, 250 * (2 ** Math.min(5, failures - 1)));
        return {
          ...prior,
          consecutive_failures: failures,
          last_failure_at_ms: now,
          retry_after_ms: now + backoffMs,
          last_error: String(recordOptions.error ?? ""),
          updated_at_ms: now,
        };
      })();
    endpointHealth.set(key, next);
    ensureBound();
    return next;
  }

  function snapshot(args, transport) {
    const endpoint = endpointFor(args, transport);
    const record = endpointHealth.get(healthKey(transport, endpoint));
    const now = Date.now();
    return {
      transport,
      endpoint,
      consecutive_failures: record?.consecutive_failures ?? 0,
      last_success_at: record?.last_success_at_ms
        ? new Date(record.last_success_at_ms).toISOString()
        : undefined,
      last_failure_at: record?.last_failure_at_ms
        ? new Date(record.last_failure_at_ms).toISOString()
        : undefined,
      retry_after: record?.retry_after_ms > now
        ? new Date(record.retry_after_ms).toISOString()
        : undefined,
      backed_off: Number(record?.retry_after_ms ?? 0) > now,
      last_error: record?.last_error || undefined,
      last_success_at_ms: record?.last_success_at_ms ?? 0,
    };
  }

  function preferredOrder(args = {}) {
    const rows = ["ws", "link"].map((transport) => snapshot(args, transport));
    rows.sort((left, right) => {
      if (left.backed_off !== right.backed_off) return left.backed_off ? 1 : -1;
      if (left.last_success_at_ms !== right.last_success_at_ms) {
        return right.last_success_at_ms - left.last_success_at_ms;
      }
      return left.transport === "ws" ? -1 : 1;
    });
    return rows.map((row, index) => ({
      transport: row.transport,
      reason: index === 0
        ? (row.last_success_at_ms > 0 ? "last_known_good" : (row.backed_off ? "earliest_retry" : "default_or_healthy"))
        : (row.backed_off ? "backoff_secondary" : "secondary"),
      health: row,
    }));
  }

  function reset() {
    endpointHealth.clear();
  }

  function stats() {
    return { endpoint_count: endpointHealth.size, max_records: maxRecords };
  }

  async function dispose() {
    reset();
  }

  return Object.freeze({ dispose, preferredOrder, record, reset, snapshot, stats });
}

const defaultTmwdTransportHealthStore = createTmwdTransportHealthStore();

const preferredTmwdTransportOrder = (...args) => defaultTmwdTransportHealthStore.preferredOrder(...args);
const recordTmwdTransportResult = (...args) => defaultTmwdTransportHealthStore.record(...args);
const resetTmwdTransportHealth = () => defaultTmwdTransportHealthStore.reset();
const tmwdTransportHealthSnapshot = (...args) => defaultTmwdTransportHealthStore.snapshot(...args);

export {
  MAX_ENDPOINT_HEALTH_RECORDS,
  createTmwdTransportHealthStore,
  defaultTmwdTransportHealthStore,
  preferredTmwdTransportOrder,
  recordTmwdTransportResult,
  resetTmwdTransportHealth,
  tmwdTransportHealthSnapshot,
};
