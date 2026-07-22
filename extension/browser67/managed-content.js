(function installBrowser67ManagedContentBridge() {
  if (globalThis.__browser67ManagedContentBridge) return;
  const bridgeId = String(globalThis.__browser67TID || "");
  if (!bridgeId) return;
  const state = {
    observer: null,
    dispose() {
      this.observer?.disconnect();
      this.observer = null;
      delete globalThis.__browser67ManagedContentBridge;
    },
  };

  async function handle(element) {
    try {
      const request = element.textContent.trim()
        ? JSON.parse(element.textContent)
        : { cmd: "cookies" };
      const command = { ...request, url: request.url || location.href };
      const response = await chrome.runtime.sendMessage(command);
      element.textContent = JSON.stringify(response);
    } catch (error) {
      element.textContent = JSON.stringify({ ok: false, error: String(error?.message || error) });
    }
  }

  state.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.id === bridgeId) {
          handle(node);
          continue;
        }
        const nested = node.querySelector?.(`#${CSS.escape(bridgeId)}`);
        if (nested) handle(nested);
      }
    }
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.__browser67ManagedContentBridge = state;
})();
