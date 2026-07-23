import { cdpRunCommand } from "../cdp-runtime/index.mjs";
import { createToolError } from "../runtime/tool-errors.mjs";
import { resolvePreferredBrowserContext } from "../tmwd-runtime/index.mjs";
import {
  executeBrowserScript,
  executeTmwdCommand,
  extractBatchResults,
  normalizeAction,
  validateUploadFiles,
} from "./shared.mjs";

function dispatchFileInputEventsExpression(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, error: "input not found after setFileInputFiles" };
    ["input", "change"].forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
    return {
      ok: true,
      files_count: el.files ? el.files.length : 0,
      selector: ${JSON.stringify(selector)}
    };
  })()`;
}

async function setInputFilesViaCdp(args, selector, files, options = {}) {
  const documentResult = await cdpRunCommand(args ?? {}, "DOM.getDocument", {
    depth: 1,
    pierce: true,
  }, options);
  const rootNodeId = documentResult.result.response?.root?.nodeId;
  if (!Number.isInteger(rootNodeId)) {
    throw createToolError("EXECUTION_ERROR", "DOM.getDocument did not return root.nodeId");
  }
  const queryResult = await cdpRunCommand(args ?? {}, "DOM.querySelector", {
    nodeId: rootNodeId,
    selector,
  }, options);
  const nodeId = queryResult.result.response?.nodeId;
  if (!Number.isInteger(nodeId) || nodeId <= 0) {
    throw createToolError("NO_SESSION", `file input not found: ${selector}`);
  }
  const setResult = await cdpRunCommand(args ?? {}, "DOM.setFileInputFiles", {
    nodeId,
    files,
  }, options);
  const dispatchResult = await cdpRunCommand(args ?? {}, "Runtime.evaluate", {
    expression: dispatchFileInputEventsExpression(selector),
    awaitPromise: true,
    returnByValue: true,
  }, options);
  return {
    transport: "cdp",
    tab_id: setResult.target.id,
    target_url: setResult.target.url,
    selector,
    files_count: files.length,
    cdp: {
      node_id: nodeId,
      set_file_input_files: setResult.result.response ?? {},
      dispatch: dispatchResult.result.response?.result?.value ?? dispatchResult.result.response ?? {},
    },
  };
}

async function setInputFilesViaTmwd(args, selector, files, options = {}) {
  const command = {
    cmd: "batch",
    commands: [
      {
        cmd: "cdp",
        method: "DOM.getDocument",
        params: { depth: 1, pierce: true },
      },
      {
        cmd: "cdp",
        method: "DOM.querySelector",
        params: { nodeId: "$0.data.root.nodeId", selector },
      },
      {
        cmd: "cdp",
        method: "DOM.setFileInputFiles",
        params: { nodeId: "$1.data.nodeId", files },
      },
      {
        cmd: "cdp",
        method: "Runtime.evaluate",
        params: {
          expression: dispatchFileInputEventsExpression(selector),
          awaitPromise: true,
          returnByValue: true,
        },
      },
    ],
  };
  const result = await executeTmwdCommand(args, command, options);
  const results = extractBatchResults(result);
  const failed = results.find((item) => item?.ok === false);
  if (failed) {
    throw createToolError("EXECUTION_ERROR", String(failed.error ?? "TMWD batch file upload failed"), {
      details: { results },
    });
  }
  return {
    status: "success",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    selector,
    files_count: files.length,
    results,
  };
}

async function handleInspectInputs(args, options = {}) {
  const selector = String(args?.selector ?? "input[type=file]").trim() || "input[type=file]";
  const result = await executeBrowserScript(args, `
    const selector = input.selector || 'input[type=file]';
    return Array.from(document.querySelectorAll(selector)).slice(0, 100).map((el, index) => {
      const rect = el.getBoundingClientRect();
      return {
        index,
        id: el.id || "",
        name: el.getAttribute("name") || "",
        accept: el.getAttribute("accept") || "",
        multiple: el.multiple === true,
        disabled: el.disabled === true,
        hidden: el.hidden === true || getComputedStyle(el).display === "none",
        visible: rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden",
        files_count: el.files ? el.files.length : 0,
        selector_hint: el.id ? "#" + CSS.escape(el.id) : selector
      };
    });
  `, { selector }, options);
  return {
    status: "success",
    action: "inspect_inputs",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    selector,
    inputs: Array.isArray(result.value) ? result.value : [],
  };
}

async function handleSetInputFiles(args, options = {}) {
  const selector = String(args?.selector ?? "").trim();
  if (!selector) {
    throw createToolError("INVALID_ARGUMENT", "selector is required when action=set_input_files");
  }
  const files = await validateUploadFiles(args?.files);
  const preferred = await resolvePreferredBrowserContext(args ?? {}, options);
  if (preferred.transport === "tmwd_ws" || preferred.transport === "tmwd_link") {
    return setInputFilesViaTmwd(args, selector, files, options);
  }
  return {
    status: "success",
    action: "set_input_files",
    ...(await setInputFilesViaCdp(args, selector, files, options)),
  };
}

async function handleUploadViaDataTransfer(args, options = {}) {
  const selector = String(args?.selector ?? "").trim();
  if (!selector) {
    throw createToolError("INVALID_ARGUMENT", "selector is required when action=upload_via_data_transfer");
  }
  const fileName = String(args?.name ?? args?.filename ?? "").trim();
  if (!fileName) {
    throw createToolError("INVALID_ARGUMENT", "name is required when action=upload_via_data_transfer");
  }
  const hasBase64 = typeof args?.base64 === "string" && args.base64.length > 0;
  const hasContent = typeof args?.content === "string";
  if (!hasBase64 && !hasContent) {
    throw createToolError("INVALID_ARGUMENT", "content or base64 is required when action=upload_via_data_transfer");
  }
  const rawLength = hasBase64 ? String(args.base64).length : String(args.content ?? "").length;
  if (rawLength > 3_000_000) {
    throw createToolError("INVALID_ARGUMENT", "DataTransfer upload payload is too large; use set_input_files with local files");
  }
  const result = await executeBrowserScript(args, `
    const el = document.querySelector(input.selector);
    if (!el) return { ok: false, error: "file input not found: " + input.selector };
    if (el.type !== "file") return { ok: false, error: "selector does not target an input[type=file]" };
    let blobPart;
    if (input.base64) {
      const binary = atob(input.base64);
      const bytes = new Uint8Array(binary.length);
      Array.from(binary).forEach((char, index) => { bytes[index] = char.charCodeAt(0); });
      blobPart = bytes;
    } else {
      blobPart = String(input.content ?? "");
    }
    const file = new File([blobPart], input.name, { type: input.mime_type || "application/octet-stream" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    ["input", "change"].forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
    return { ok: true, selector: input.selector, name: file.name, size: file.size, files_count: el.files.length };
  `, {
    selector,
    name: fileName,
    mime_type: String(args?.mime_type ?? args?.type ?? "application/octet-stream"),
    content: hasContent ? String(args.content ?? "") : undefined,
    base64: hasBase64 ? String(args.base64 ?? "") : undefined,
  }, options);
  if (result.value?.ok === false) {
    throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "DataTransfer upload failed"));
  }
  return {
    status: "success",
    action: "upload_via_data_transfer",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    result: result.value,
  };
}

function handleNativeFileChooserPlan(args) {
  return {
    status: "success",
    action: "native_file_chooser_plan",
    executable: false,
    next_step: "Use Computer Use or browser_native_input only after explicit approval to interact with a native file chooser.",
    selector: String(args?.selector ?? ""),
    files: Array.isArray(args?.files) ? args.files.map((item) => String(item)) : [],
    plan: [
      "Prefer browser_file_ops.set_input_files with real local files.",
      "If the site requires an isTrusted native chooser, focus/click the upload control.",
      "Use native input to type/paste the file path and confirm the chooser.",
      "Do not upload unrelated local files; keep file paths task-scoped.",
    ],
  };
}

async function handleBrowserFileOps(args, options = {}) {
  const action = normalizeAction(args, [
    "inspect_inputs",
    "set_input_files",
    "upload_via_data_transfer",
    "native_file_chooser_plan",
  ]);
  if (action === "inspect_inputs") {
    return handleInspectInputs(args, options);
  }
  if (action === "set_input_files") {
    return handleSetInputFiles(args, options);
  }
  if (action === "upload_via_data_transfer") {
    return handleUploadViaDataTransfer(args, options);
  }
  return handleNativeFileChooserPlan(args);
}

export { handleBrowserFileOps };
