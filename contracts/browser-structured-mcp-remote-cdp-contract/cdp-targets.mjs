function pollUntil({ probe, timeoutMs, intervalMs, timeoutMessage }) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolvePromise, rejectPromise) => {
    let timer = null;
    let lastValue = "";
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback(value);
    };

    const schedule = () => {
      timer = setTimeout(runProbe, intervalMs);
    };

    const runProbe = () => {
      if (Date.now() >= deadline) {
        finish(rejectPromise, new Error(timeoutMessage(lastValue)));
        return;
      }
      Promise.resolve()
        .then(probe)
        .then((result) => {
          if (result?.done === true) {
            finish(resolvePromise, result.value);
            return;
          }
          lastValue = String(result?.lastValue ?? lastValue);
          schedule();
        })
        .catch((error) => {
          lastValue = String(error?.message ?? error);
          schedule();
        });
    };

    runProbe();
  });
}

async function waitForUrl(url, timeoutMs) {
  return pollUntil({
    timeoutMs,
    intervalMs: 250,
    probe: async () => {
      const response = await fetch(url);
      if (response.ok) {
        return {
          done: true,
          value: response,
        };
      }
      return {
        done: false,
        lastValue: `http_${String(response.status)}`,
      };
    },
    timeoutMessage: (lastError) => `timed out waiting on ${url}: ${lastError || "no response"}`,
  });
}

async function waitForCdpTarget(cdpEndpoint, expectedUrl, timeoutMs) {
  const endpoint = `${String(cdpEndpoint).replace(/\/$/, "")}/json/list`;
  return pollUntil({
    timeoutMs,
    intervalMs: 250,
    probe: async () => {
      const response = await fetch(endpoint);
      const rows = await response.json();
      const targets = Array.isArray(rows) ? rows : [];
      const pageUrls = targets
        .filter((item) => item?.type === "page")
        .map((item) => String(item?.url ?? ""));
      const lastSeen = pageUrls.join(", ");
      const matched = targets.find((item) => item?.type === "page" && String(item?.url ?? "") === expectedUrl);
      if (matched) {
        return {
          done: true,
          value: {
            id: String(matched.id ?? ""),
            url: String(matched.url ?? ""),
            title: String(matched.title ?? ""),
          },
        };
      }
      return {
        done: false,
        lastValue: lastSeen,
      };
    },
    timeoutMessage: (lastSeen) => `timed out waiting on CDP target url=${expectedUrl}; last_seen=${lastSeen || "<none>"}`,
  });
}

async function createCdpTarget(cdpEndpoint, url) {
  const base = String(cdpEndpoint).replace(/\/$/, "");
  const targetUrl = `${base}/json/new?${encodeURIComponent(url)}`;
  let response = await fetch(targetUrl, { method: "PUT" });
  if (!response.ok && response.status === 405) {
    response = await fetch(targetUrl);
  }
  if (!response.ok) {
    throw new Error(`CDP /json/new failed status=${String(response.status)}`);
  }
  const payload = await response.json();
  return {
    id: String(payload?.id ?? ""),
    url: String(payload?.url ?? ""),
  };
}

async function closeOtherCdpTargets(cdpEndpoint, keepTargetId) {
  const base = String(cdpEndpoint).replace(/\/$/, "");
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) {
    return;
  }
  const rows = await response.json();
  const targets = Array.isArray(rows) ? rows : [];
  await Promise.all(targets
    .filter((item) => item?.type === "page")
    .filter((item) => String(item?.id ?? "") !== keepTargetId)
    .map(async (item) => {
      try {
        await fetch(`${base}/json/close/${encodeURIComponent(String(item.id))}`);
      } catch {
        // best-effort cleanup
      }
    }));
}

export {
  closeOtherCdpTargets,
  createCdpTarget,
  waitForCdpTarget,
  waitForUrl,
};
