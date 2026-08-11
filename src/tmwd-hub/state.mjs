function createHubState() {
  return {
    defaultBrowserInstanceId: "",
    defaultSessionByInstance: new Map(),
    latestSessionKey: "",
    sessions: new Map(),
    pendingExec: new Map(),
    clientSockets: new Set(),
    browserInstances: new Map(),
    socketBrowserInstances: new Map(),
  };
}

export {
  createHubState,
};
