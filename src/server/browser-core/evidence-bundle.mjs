import { buildDesignCraftL4Manifest } from "../../browser-screenshot/design-craft-l4.mjs";
import { createToolError } from "../../errors.mjs";

async function handleBrowserEvidenceBundleOps(args = {}) {
  const action = String(args.action ?? "build_design_craft_l4_manifest").trim()
    || "build_design_craft_l4_manifest";
  if (action !== "build_design_craft_l4_manifest") {
    throw createToolError("INVALID_ARGUMENT", `unknown browser_evidence_bundle_ops action: ${action}`, {
      retryable: false,
      details: { accepted_actions: ["build_design_craft_l4_manifest"] },
    });
  }
  return buildDesignCraftL4Manifest({
    ...args,
    action,
  });
}

export {
  handleBrowserEvidenceBundleOps,
};
