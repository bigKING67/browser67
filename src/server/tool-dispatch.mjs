import {
  handleBrowserClipboardOps,
  handleBrowserDownloadOps,
  handleBrowserFileOps,
  handleBrowserTabLifecycle,
} from "../browser-wrappers.mjs";
import { handleBrowserAuthOps } from "../browser-auth.mjs";
import { makeErrorPayload } from "../errors.mjs";
import { handleBrowserNativeInput } from "../native-input.mjs";
import { makeResult } from "../mcp-result.mjs";
import { handleBrowserRunOps } from "../run-lifecycle.mjs";
import {
  handleBrowserDiff,
  handleBrowserExecuteJs,
  handleBrowserExtract,
  handleBrowserJobOps,
  handleBrowserScan,
  handleBrowserScreenshotOps,
  handleBrowserTabOps,
  handleBrowserTransportHealth,
  handleBrowserWait,
} from "./browser-core.mjs";

async function dispatchToolCall(name, args) {
  try {
    if (name === "browser_scan") {
      return makeResult(await handleBrowserScan(args));
    }
    if (name === "browser_execute_js") {
      return makeResult(await handleBrowserExecuteJs(args));
    }
    if (name === "browser_wait") {
      return makeResult(await handleBrowserWait(args));
    }
    if (name === "browser_transport_health") {
      return makeResult(await handleBrowserTransportHealth(args));
    }
    if (name === "browser_run_ops") {
      return makeResult(await handleBrowserRunOps(args));
    }
    if (name === "browser_job_ops") {
      return makeResult(await handleBrowserJobOps(args));
    }
    if (name === "browser_extract") {
      return makeResult(await handleBrowserExtract(args));
    }
    if (name === "browser_diff") {
      return makeResult(handleBrowserDiff(args));
    }
    if (name === "browser_screenshot_ops") {
      return makeResult(await handleBrowserScreenshotOps(args));
    }
    if (name === "browser_tab_ops") {
      return makeResult(await handleBrowserTabOps(args));
    }
    if (name === "browser_native_input") {
      return makeResult(await handleBrowserNativeInput(args));
    }
    if (name === "browser_file_ops") {
      return makeResult(await handleBrowserFileOps(args));
    }
    if (name === "browser_download_ops") {
      return makeResult(await handleBrowserDownloadOps(args));
    }
    if (name === "browser_tab_lifecycle") {
      return makeResult(await handleBrowserTabLifecycle(args));
    }
    if (name === "browser_auth_ops") {
      return makeResult(await handleBrowserAuthOps(args));
    }
    if (name === "browser_clipboard_ops") {
      return makeResult(await handleBrowserClipboardOps(args));
    }
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `unknown tool: ${String(name)}`,
        },
      ],
    };
  } catch (error) {
    return makeErrorPayload(name, error);
  }
}

export {
  dispatchToolCall,
};
