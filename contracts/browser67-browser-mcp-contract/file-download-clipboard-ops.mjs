import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

export async function assertFileDownloadClipboardOpsContract({ rpc, timeoutMs }) {
  let tmpDownloadDir;
  try {
    const filePlanCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "native_file_chooser_plan",
          selector: "input[type=file]",
          files: ["/tmp/example-upload.txt"],
        },
      },
      timeoutMs,
    );
    assert.equal(filePlanCall?.result?.isError, undefined);
    assertTextJsonContent(filePlanCall.result, "browser_file_ops success result");
    const filePlanPayload = firstJsonContent(filePlanCall.result);
    assert.equal(filePlanPayload?.status, "success");
    assert.equal(filePlanPayload?.action, "native_file_chooser_plan");
    assert.equal(filePlanPayload?.executable, false);

    const fileMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "set_input_files",
          selector: "input[type=file]",
        },
      },
      timeoutMs,
    );
    assert.equal(fileMissingCall?.result?.isError, true);
    assertTextJsonContent(fileMissingCall.result, "browser_file_ops missing args error");
    const fileMissingPayload = firstJsonContent(fileMissingCall.result);
    assert.equal(fileMissingPayload?.error_code, "INVALID_ARGUMENT");

    const fileUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_file_ops",
        arguments: {
          action: "unsupported_file_action",
        },
      },
      timeoutMs,
    );
    assert.equal(fileUnsupportedCall?.result?.isError, true);
    const fileUnsupportedPayload = firstJsonContent(fileUnsupportedCall.result);
    assert.equal(fileUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    tmpDownloadDir = await fs.mkdtemp(path.join(os.tmpdir(), "tmwd-download-contract-"));
    const downloadPrepareCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "prepare",
          download_dir: tmpDownloadDir,
          set_behavior: false,
        },
      },
      timeoutMs,
    );
    assert.equal(downloadPrepareCall?.result?.isError, undefined);
    assertTextJsonContent(downloadPrepareCall.result, "browser_download_ops prepare result");
    const downloadPreparePayload = firstJsonContent(downloadPrepareCall.result);
    assert.equal(downloadPreparePayload?.status, "success");
    assert.equal(downloadPreparePayload?.action, "prepare");
    assert.equal(typeof downloadPreparePayload?.token, "string");

    const downloadMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "wait",
        },
      },
      timeoutMs,
    );
    assert.equal(downloadMissingCall?.result?.isError, true);
    assertTextJsonContent(downloadMissingCall.result, "browser_download_ops missing args error");
    const downloadMissingPayload = firstJsonContent(downloadMissingCall.result);
    assert.equal(downloadMissingPayload?.error_code, "INVALID_ARGUMENT");

    const downloadUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_download_ops",
        arguments: {
          action: "unsupported_download_action",
        },
      },
      timeoutMs,
    );
    assert.equal(downloadUnsupportedCall?.result?.isError, true);
    const downloadUnsupportedPayload = firstJsonContent(downloadUnsupportedCall.result);
    assert.equal(downloadUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    const clipboardDryRunCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "write_text",
          text: "contract clipboard text",
          dry_run: true,
        },
      },
      timeoutMs,
    );
    assert.equal(clipboardDryRunCall?.result?.isError, undefined);
    assertTextJsonContent(clipboardDryRunCall.result, "browser_clipboard_ops success result");
    const clipboardDryRunPayload = firstJsonContent(clipboardDryRunCall.result);
    assert.equal(clipboardDryRunPayload?.status, "success");
    assert.equal(clipboardDryRunPayload?.action, "write_text");
    assert.equal(clipboardDryRunPayload?.read_supported, false);

    const clipboardMissingCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "write_text",
        },
      },
      timeoutMs,
    );
    assert.equal(clipboardMissingCall?.result?.isError, true);
    assertTextJsonContent(clipboardMissingCall.result, "browser_clipboard_ops missing args error");
    const clipboardMissingPayload = firstJsonContent(clipboardMissingCall.result);
    assert.equal(clipboardMissingPayload?.error_code, "INVALID_ARGUMENT");

    const clipboardUnsupportedCall = await rpc.call(
      "tools/call",
      {
        name: "browser_clipboard_ops",
        arguments: {
          action: "read_text",
        },
      },
      timeoutMs,
    );
    assert.equal(clipboardUnsupportedCall?.result?.isError, true);
    const clipboardUnsupportedPayload = firstJsonContent(clipboardUnsupportedCall.result);
    assert.equal(clipboardUnsupportedPayload?.error_code, "ACTION_NOT_SUPPORTED");

    return {
      filePlanPayload,
      downloadPreparePayload,
      clipboardDryRunPayload,
    };
  } finally {
    if (tmpDownloadDir) {
      await fs.rm(tmpDownloadDir, { recursive: true, force: true });
    }
  }
}
