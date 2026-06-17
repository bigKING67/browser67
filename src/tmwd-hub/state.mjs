function createHubState() {
  return {
    defaultSessionId: "",
    latestSessionId: "",
    sessions: new Map(),
    pendingExec: new Map(),
    clientSockets: new Set(),
    extensionSocket: null,
  };
}

export {
  createHubState,
};
