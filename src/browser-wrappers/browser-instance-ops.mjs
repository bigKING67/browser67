import { callTmwdLink } from "../tmwd-runtime/link.mjs";

async function handleBrowserInstanceOps(args = {}) {
  const action = String(args.action ?? "list").trim();
  if (action === "set_default" && !String(args.browser_instance_id ?? "").trim()) {
    throw new Error("browser_instance_id is required for set_default");
  }
  const result = await callTmwdLink(args, {
    cmd: "browser_instance_ops",
    action,
    browser_instance_id: args.browser_instance_id,
  });
  if (!result.value || result.value.ok !== true) {
    throw new Error(String(result.value?.error ?? "browser instance operation failed"));
  }
  return {
    ...result.value,
    tmwd_link_endpoint: result.endpoint,
  };
}

export { handleBrowserInstanceOps };
