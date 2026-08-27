import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { handleBrowserTransportHealth } from "../../src/server/browser-core/transport-health.mjs";
import { firstJsonContent } from "./rpc-content.mjs";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function assertRunWaitHealthOpsContract({ rpc, timeoutMs, runRoot }) {
    const privateTarget = {
      endpoint: "ws://127.0.0.1:18765",
      targets: [{ id: "private-target", url: "https://private.example/account" }],
      target: { id: "private-target", url: "https://private.example/account" },
    };
    const transportResolver = async () => privateTarget;
    const privateByDefault = await handleBrowserTransportHealth(
      { tmwd_transport: "ws" },
      { resolveTmwdContextWithTransport: transportResolver },
    );
    assert.equal(privateByDefault.status, "healthy");
    assert.equal(privateByDefault.transports[0].pages_count, 1);
    assert.equal(Object.hasOwn(privateByDefault.transports[0], "selected_tab_id"), false);
    assert.equal(JSON.stringify(privateByDefault).includes("private.example"), false);
    const metadataOptIn = await handleBrowserTransportHealth(
      { tmwd_transport: "ws", include_target_metadata: true },
      { resolveTmwdContextWithTransport: transportResolver },
    );
    assert.equal(metadataOptIn.transports[0].selected_tab_id, "private-target");
    assert.equal(metadataOptIn.transports[0].selected_url, "https://private.example/account");

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

    const inspectCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: { action: "inspect" },
      },
      timeoutMs,
    );
    const inspectPayload = firstJsonContent(inspectCall.result);
    assert.equal(inspectPayload?.ok, true);
    assert.equal(inspectPayload?.action, "inspect");
    assert.equal(inspectPayload?.run_count >= 1, true);
    assert.equal(Array.isArray(inspectPayload?.groups), true);

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
    assert.equal(jobStartPayload?.job?.run_ownership, "job");
    assert.equal(jobStartPayload?.job?.run_auto_finish, true);
    assert.equal(jobStartPayload?.job?.run_requires_finish, false);
    assert.equal(jobStartPayload?.job?.abort_supported, false);
    assert.equal(typeof jobStartPayload?.job?.checkpoint_at, "string");
    assert.equal(typeof jobStartPayload?.job?.execution_deadline_at, "string");
    assert.equal(typeof jobStartPayload?.job?.job_id, "string");

    const jobId = jobStartPayload.job.job_id;
    let jobStatusPayload = null;
    const jobDeadlineAt = Date.now() + Math.min(10_000, Math.max(1_000, timeoutMs));
    while (Date.now() < jobDeadlineAt) {
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
    assert.equal(
      jobStatusPayload?.job?.status,
      "failed",
      `background job did not reach failed before deadline: ${JSON.stringify(jobStatusPayload?.job ?? null)}`,
    );

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
    assert.equal(jobResultPayload?.job?.run_terminalized, true);
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
    const autoOwnedRun = JSON.parse(await readFile(join(
      runRoot,
      "contract-workspace",
      jobStartPayload.job.run_id,
      "run.json",
    ), "utf8"));
    assert.equal(autoOwnedRun.status, "failed");
    assert.equal(typeof autoOwnedRun.finished_at, "string");
    assert.equal(autoOwnedRun.summary.job_id, jobId);

    const jobSummaryCall = await rpc.call(
      "tools/call",
      {
        name: "browser_job_ops",
        arguments: {
          action: "list",
          summary_only: true,
        },
      },
      timeoutMs,
    );
    const jobSummaryPayload = firstJsonContent(jobSummaryCall.result);
    assert.equal(jobSummaryPayload?.ok, true);
    assert.equal(jobSummaryPayload?.summary_only, true);
    assert.equal(jobSummaryPayload?.total >= 1, true);
    assert.equal(jobSummaryPayload?.returned_count, 0);
    assert.deepEqual(jobSummaryPayload?.jobs, []);
    assert.equal(jobSummaryPayload?.status_counts?.failed >= 1, true);
    assert.equal(jobSummaryPayload?.durable_count >= 1, true);
    assert.equal(jobSummaryPayload?.auto_finish_run_count >= 1, true);
    assert.equal(jobSummaryPayload?.run_terminalized_count >= 1, true);
    assert.equal(JSON.stringify(jobSummaryPayload).includes("contract failing job"), false);

    const callerRunPrepareCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "prepare",
          workspace_key: "contract-workspace",
          run_id: "caller-owned-job-run",
          title: "caller-owned job run",
        },
      },
      timeoutMs,
    );
    const callerRunPreparePayload = firstJsonContent(callerRunPrepareCall.result);
    assert.equal(callerRunPreparePayload?.ok, true);
    const callerJobStartCall = await rpc.call(
      "tools/call",
      {
        name: "browser_job_ops",
        arguments: {
          action: "start",
          workspace_key: "contract-workspace",
          run_id: "caller-owned-job-run",
          title: "caller-owned failing job",
          tmwd_mode: "tmwd",
          tmwd_transport: "ws",
          tmwd_ws_endpoint: "ws://127.0.0.1:9",
          timeout_ms: 200,
          script: "return 1;",
        },
      },
      timeoutMs,
    );
    const callerJobStartPayload = firstJsonContent(callerJobStartCall.result);
    assert.equal(callerJobStartPayload?.ok, true);
    assert.equal(callerJobStartPayload?.job?.run_ownership, "caller");
    assert.equal(callerJobStartPayload?.job?.run_auto_finish, false);
    assert.equal(callerJobStartPayload?.job?.run_requires_finish, true);
    const callerJobId = callerJobStartPayload.job.job_id;
    let callerJobStatusPayload = null;
    const callerJobDeadlineAt = Date.now() + Math.min(10_000, Math.max(1_000, timeoutMs));
    while (Date.now() < callerJobDeadlineAt) {
      await sleep(50);
      const callerJobStatusCall = await rpc.call(
        "tools/call",
        {
          name: "browser_job_ops",
          arguments: { action: "status", job_id: callerJobId },
        },
        timeoutMs,
      );
      callerJobStatusPayload = firstJsonContent(callerJobStatusCall.result);
      if (["completed", "failed"].includes(callerJobStatusPayload?.job?.status)) break;
    }
    assert.equal(callerJobStatusPayload?.job?.status, "failed");
    assert.equal(callerJobStatusPayload?.job?.run_terminalized, false);
    const callerOwnedRunPath = join(
      runRoot,
      "contract-workspace",
      "caller-owned-job-run",
      "run.json",
    );
    const callerOwnedRun = JSON.parse(await readFile(callerOwnedRunPath, "utf8"));
    assert.equal(callerOwnedRun.status, "running");
    assert.equal(callerOwnedRun.finished_at, null);
    const callerRunFinishCall = await rpc.call(
      "tools/call",
      {
        name: "browser_run_ops",
        arguments: {
          action: "finish",
          workspace_key: "contract-workspace",
          run_id: "caller-owned-job-run",
          status: "success",
        },
      },
      timeoutMs,
    );
    assert.equal(firstJsonContent(callerRunFinishCall.result)?.ok, true);

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
