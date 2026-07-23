function createHubState() {
  return {
    defaultSessionId: "",
    latestSessionId: "",
    sessions: new Map(),
    pendingExec: new Map(),
    clientSockets: new Set(),
    extensionSocket: null,
    extensionIdentity: null,
    extensionIdentityStatus: "missing",
    extensionIdentityReceivedAt: null,
    extensionConnectedAt: null,
    extensionDisconnectedAt: null,
  };
}

export {
  createHubState,
};
