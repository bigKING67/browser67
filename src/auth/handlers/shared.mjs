import { createToolError } from "../../errors.mjs";

function normalizeAction(args, supported) {
  const action = String(args?.action ?? "").trim().toLowerCase();
  if (!action) {
    throw createToolError("INVALID_ARGUMENT", "action is required", {
      details: { supported_actions: supported },
    });
  }
  if (!supported.includes(action)) {
    throw createToolError("ACTION_NOT_SUPPORTED", `action not supported: ${action}`, {
      details: { supported_actions: supported },
    });
  }
  return action;
}

function pageStateWithPage(pageState, page) {
  return {
    ...(pageState ?? {}),
    page: pageState?.page ?? page,
  };
}

export {
  normalizeAction,
  pageStateWithPage,
};
