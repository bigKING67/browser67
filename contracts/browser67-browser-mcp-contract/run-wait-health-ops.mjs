import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { firstJsonContent } from "./rpc-content.mjs";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function assertRunWaitHealthOpsContract({ rpc, timeoutMs, runRoot }) {
    const prepareCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "prepare",
          workspace_key: "contract-workspace",
          task_id: "contract-task",
          title: "contract run",
          data: { purpose: "contract" },
        },
      },
      timeoutMs,
    );
    const preparePayload = firstJsonContent(prepareCall.result);
    assert.equal(preparePayload?.ok, true);
    assert.equal(preparePayload?.run?.schema_version, "browser67.run.v2");
    assert.equal(preparePayload?.run?.status, "running");
    assert.equal(typeof preparePayload?.run?.run_id, "string");

    const runId = preparePayload.run.run_id;
    const eventCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "record_event",
          workspace_key: "contract-workspace",
          run_id: runId,
          event: "evidence",
          evidence: {
            source: "network",
            confidence: "exact",
            title: "contract evidence",
            data: { ok: true },
          },
        },
      },
      timeoutMs,
    );
    const eventPayload = firstJsonContent(eventCall.result);
    assert.equal(eventPayload?.ok, true);
    assert.equal(eventPayload?.event?.evidence?.schema_version, "evidence.v1");
    assert.equal(eventPayload?.event?.evidence?.source, "network");
    assert.equal(eventPayload?.event?.evidence?.confidence, "exact");

    const statusCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "status",
          workspace_key: "contract-workspace",
          run_id: runId,
        },
      },
      timeoutMs,
    );
    const statusPayload = firstJsonContent(statusCall.result);
    assert.equal(statusPayload?.ok, true);
    assert.equal(statusPayload?.recent_events?.length >= 2, true);

    const finishCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "finish",
          workspace_key: "contract-workspace",
          run_id: runId,
          status: "success",
          data: { rows: 1 },
        },
      },
      timeoutMs,
    );
    const finishPayload = firstJsonContent(finishCall.result);
    assert.equal(finishPayload?.ok, true);
    assert.equal(finishPayload?.run?.status, "success");
    assert.equal(finishPayload?.run?.summary?.rows, 1);

    const healthCall = await rpc.call(
      "tools/call",
      {
        name: "browser_transport_health",
        arguments: {
          tmwd_transport: "ws",
          tmwd_ws_endpoint: "ws://127.0.0.1:9",
          timeout_ms: 200,
        },
      },
      timeoutMs,
    );
    const healthPayload = firstJsonContent(healthCall.result);
    assert.equal(healthPayload?.status, "broken");
    assert.equal(healthPayload?.ok, false);
    assert.equal(healthPayload?.transports?.[0]?.transport, "ws");
    assert.equal(typeof healthPayload?.suggestion, "string");

    const invalidWaitCall = await rpc.call(
      "tools/call",
      {
        name: "browser_wait",
        arguments: {
          type: "selector",
        },
      },
      timeoutMs,
    );
    const invalidWaitPayload = firstJsonContent(invalidWaitCall.result);
    assert.equal(invalidWaitPayload?.status, "invalid_argument");
    assert.equal(invalidWaitPayload?.ok, false);

    const missingJobCodeCall = await rpc.call(
      "tools/call",
      {
        name: "browser_job_ops",
        arguments: {
          action: "start",
        },
      },
      timeoutMs,
    );
    const missingJobCodePayload = firstJsonContent(missingJobCodeCall.result);
    assert.equal(missingJobCodePayload?.ok, false);
    assert.equal(missingJobCodePayload?.action, "start");

    const jobStartCall = await rpc.call(
      "tools/call",
      {
        name: "browser_job_ops",
        arguments: {
          action: "start",
          workspace_key: "contract-workspace",
          title: "contract failing job",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: "ws://127.0.0.1:9",
          timeout_ms: 200,
          output_mode: "compact",
          script: "return 1;",
        },
      },
      timeoutMs,
    );
    const jobStartPayload = firstJsonContent(jobStartCall.result);
    assert.equal(jobStartPayload?.ok, true);
    assert.equal(jobStartPayload?.job?.schema_version, "browser67.browser-job.v3");
    assert.equal(jobStartPayload?.job?.durable, true);
    assert.equal(jobStartPayload?.job?.durability_reason, "run_backed_checkpoint");
    assert.equal(jobStartPayload?.job?.abort_supported, false);
    assert.equal(typeof jobStartPayload?.job?.checkpoint_at, "string");
    assert.equal(typeof jobStartPayload?.job?.execution_deadline_at, "string");
    assert.equal(typeof jobStartPayload?.job?.job_id, "string");

    const jobId = jobStartPayload.job.job_id;
    let jobStatusPayload = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(50);
      const jobStatusCall = await rpc.call(
        "tools/call",
        {
          name: "browser_job_ops",
          arguments: {
            action: "status",
            job_id: jobId,
          },
        },
        timeoutMs,
      );
      jobStatusPayload = firstJsonContent(jobStatusCall.result);
      if (["completed", "failed"].includes(jobStatusPayload?.job?.status)) {
        break;
      }
    }
    assert.equal(jobStatusPayload?.ok, true);
    assert.equal(jobStatusPayload?.job?.status, "failed");

    const jobResultCall = await rpc.call(
      "tools/call",
      {
        name: "browser_job_ops",
        arguments: {
          action: "result",
          job_id: jobId,
        },
      },
      timeoutMs,
    );
    const jobResultPayload = firstJsonContent(jobResultCall.result);
    assert.equal(jobResultPayload?.ok, true);
    assert.equal(jobResultPayload?.result_available, true);
    assert.equal(jobResultPayload?.job?.status, "failed");
    assert.equal(jobResultPayload?.job?.result?.status, "failed");
    assert.equal(typeof jobResultPayload?.job?.error, "string");
    const jobStatePath = join(
      runRoot,
      "contract-workspace",
      jobStartPayload.job.run_id,
      "jobs",
      `${jobId}.json`,
    );
    const persistedJob = JSON.parse(await readFile(jobStatePath, "utf8"));
    assert.equal(persistedJob.schema_version, "browser67.browser-job.v3");
    assert.equal(persistedJob.status, "failed");
    assert.equal(persistedJob.durable, true);

  return {
    run_id: runId,
    run_root: runRoot,
    transport_health_status: healthPayload.status,
    job_id: jobId,
  };
}

export {
  assertRunWaitHealthOpsContract,
};
