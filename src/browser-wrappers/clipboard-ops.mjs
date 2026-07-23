import { createToolError } from "../runtime/tool-errors.mjs";
import { handleBrowserNativeInput } from "../native/input.mjs";
import {
  executeBrowserScript,
  normalizeAction,
} from "./shared.mjs";

async function writeClipboardText(args, options = {}) {
  const text = String(args?.text ?? "");
  if (!Object.prototype.hasOwnProperty.call(args ?? {}, "text")) {
    throw createToolError("INVALID_ARGUMENT", "text is required when action=write_text");
  }
  if (args?.dry_run === true) {
    return {
      status: "success",
      action: "write_text",
      dry_run: true,
      text_length: text.length,
      read_supported: false,
      next_step: "Call without dry_run to write text through navigator.clipboard in the active browser page.",
    };
  }
  const result = await executeBrowserScript(args, `
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
      return { ok: false, error: "navigator.clipboard.writeText is unavailable" };
    }
    await navigator.clipboard.writeText(input.text);
    return { ok: true, text_length: input.text.length };
  `, { text }, options);
  if (result.value?.ok === false) {
    throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "clipboard write failed"));
  }
  return {
    status: "success",
    action: "write_text",
    transport: result.transport,
    transport_attempts: result.transport_attempts,
    page: result.page,
    text_length: text.length,
    read_supported: false,
  };
}

async function pasteClipboardText(args, options = {}) {
  const text = String(args?.text ?? "");
  if (!Object.prototype.hasOwnProperty.call(args ?? {}, "text")) {
    throw createToolError("INVALID_ARGUMENT", "text is required when action=paste_text");
  }
  const selector = String(args?.selector ?? "").trim();
  if (selector && args?.real_paste !== true) {
    const result = await executeBrowserScript(args, `
      const el = document.querySelector(input.selector);
      if (!el) return { ok: false, error: "target not found: " + input.selector };
      const previous = "value" in el ? String(el.value ?? "") : String(el.textContent ?? "");
      if ("value" in el) {
        el.value = input.text;
      } else {
        el.textContent = input.text;
      }
      ["input", "change"].forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
      return { ok: true, selector: input.selector, previous_length: previous.length, text_length: input.text.length };
    `, { selector, text }, options);
    if (result.value?.ok === false) {
      throw createToolError("EXECUTION_ERROR", String(result.value.error ?? "DOM paste failed"));
    }
    return {
      status: "success",
      action: "paste_text",
      method: "dom_value",
      transport: result.transport,
      transport_attempts: result.transport_attempts,
      page: result.page,
      result: result.value,
    };
  }
  const native = await handleBrowserNativeInput({
    ...args,
    action: "paste",
    text,
  }, options);
  return {
    status: "success",
    action: "paste_text",
    method: "native_paste",
    native_result: native,
  };
}

async function handleBrowserClipboardOps(args, options = {}) {
  const action = normalizeAction(args, [
    "write_text",
    "paste_text",
  ]);
  if (action === "write_text") {
    return writeClipboardText(args, options);
  }
  return pasteClipboardText(args, options);
}

export { handleBrowserClipboardOps };
