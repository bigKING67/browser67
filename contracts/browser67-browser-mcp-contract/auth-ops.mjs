import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertTextJsonContent,
  firstJsonContent,
} from "./rpc-content.mjs";

async function assertAuthOpsContract({
  rpc,
  timeoutMs,
  tmpLoginProfileDir,
  tmpTooManyLoginProfileDir,
}) {
  const authListCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "list_profiles",
      },
    },
    timeoutMs,
  );
  assert.equal(authListCall?.result?.isError, undefined);
  assertTextJsonContent(authListCall.result, "browser_auth_ops list_profiles result");
  const authListPayload = firstJsonContent(authListCall.result);
  assert.equal(authListPayload?.status, "success");
  assert.equal(authListPayload?.action, "list_profiles");
  assert.equal(authListPayload?.secrets_redacted, true);
  const authProfileIds = authListPayload?.profiles?.map((entry) => entry?.profile_id) ?? [];
  assert.equal(authProfileIds.includes("alpha-site"), true);
  assert.ok(
    authProfileIds.indexOf("alpha-site") < authProfileIds.indexOf("contract-site"),
    "login profiles should be listed in deterministic filename order",
  );
  const contractProfile = authListPayload?.profiles?.find((entry) => entry?.profile_id === "contract-site");
  assert.equal(contractProfile?.has_username, true);
  assert.equal(contractProfile?.has_password, true);
  assert.equal(JSON.stringify(authListPayload).includes("contract-password"), false);
  assert.equal(JSON.stringify(authListPayload).includes("alpha-password"), false);

  const authDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "ensure_login",
        url: "http://example.test/login?redirect=%2Freports",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authDryRunCall?.result?.isError, undefined);
  const authDryRunPayload = firstJsonContent(authDryRunCall.result);
  assert.equal(authDryRunPayload?.status, "success");
  assert.equal(authDryRunPayload?.action, "ensure_login");
  assert.equal(authDryRunPayload?.dry_run, true);
  assert.equal(authDryRunPayload?.would_submit, true);
  assert.equal(authDryRunPayload?.profile?.profile_id, "contract-site");
  assert.equal(JSON.stringify(authDryRunPayload).includes("contract-password"), false);

  const authUnknownDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "ensure_login",
        url: "http://unknown.example/login",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authUnknownDryRunCall?.result?.isError, undefined);
  const authUnknownDryRunPayload = firstJsonContent(authUnknownDryRunCall.result);
  assert.equal(authUnknownDryRunPayload?.status, "blocked");
  assert.equal(authUnknownDryRunPayload?.reason, "no_matching_login_profile");

  const authAlreadyDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "ensure_login",
        url: "http://unknown.example/protected",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authAlreadyDryRunCall?.result?.isError, undefined);
  const authAlreadyDryRunPayload = firstJsonContent(authAlreadyDryRunCall.result);
  assert.equal(authAlreadyDryRunPayload?.status, "success");
  assert.equal(authAlreadyDryRunPayload?.already_authenticated, true);
  assert.equal(authAlreadyDryRunPayload?.would_submit, false);
  assert.equal(authAlreadyDryRunPayload?.reason, "profile_missing_but_not_needed");

  const authValidateMismatchCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "validate_profile",
        profile_id: "contract-site",
        url: "http://unknown.example/login",
      },
    },
    timeoutMs,
  );
  assert.equal(authValidateMismatchCall?.result?.isError, undefined);
  const authValidateMismatchPayload = firstJsonContent(authValidateMismatchCall.result);
  assert.equal(authValidateMismatchPayload?.status, "blocked");
  assert.equal(authValidateMismatchPayload?.reason, "origin_not_allowed_for_profile");
  assert.equal(JSON.stringify(authValidateMismatchPayload).includes("contract-password"), false);

  const authEnsureMismatchCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "ensure_login",
        profile_id: "contract-site",
        url: "http://unknown.example/login",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authEnsureMismatchCall?.result?.isError, undefined);
  const authEnsureMismatchPayload = firstJsonContent(authEnsureMismatchCall.result);
  assert.equal(authEnsureMismatchPayload?.status, "blocked");
  assert.equal(authEnsureMismatchPayload?.reason, "origin_not_allowed_for_profile");
  assert.equal(authEnsureMismatchPayload?.would_submit, false);
  assert.equal(JSON.stringify(authEnsureMismatchPayload).includes("contract-password"), false);

  const authSuggestDryRunCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "suggest_profile",
        url: "https://onboard.example/login?redirect=%2Fhome",
        dry_run: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authSuggestDryRunCall?.result?.isError, undefined);
  const authSuggestDryRunPayload = firstJsonContent(authSuggestDryRunCall.result);
  assert.equal(authSuggestDryRunPayload?.status, "success");
  assert.equal(authSuggestDryRunPayload?.action, "suggest_profile");
  assert.equal(authSuggestDryRunPayload?.profile?.profile_id, "onboard.example");
  assert.equal(authSuggestDryRunPayload?.profile?.allowed_origins?.[0], "https://onboard.example");
  assert.equal(authSuggestDryRunPayload?.profile?.has_username, false);
  assert.equal(authSuggestDryRunPayload?.profile?.has_password, false);

  const authUpsertCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "upsert_profile",
        profile_id: "onboard-site",
        origin: "https://onboard.example/login",
        username: "onboard-user",
        password: "onboard-password",
        login_path_pattern: "/login",
        username_selector: "#username",
        password_selector: "#password",
        submit_selector: "button[type=\"submit\"]",
        success_path_not: "/login",
        confirm_write: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authUpsertCall?.result?.isError, undefined);
  const authUpsertPayload = firstJsonContent(authUpsertCall.result);
  assert.equal(authUpsertPayload?.status, "success");
  assert.equal(authUpsertPayload?.created, true);
  assert.equal(authUpsertPayload?.updated, false);
  assert.equal(authUpsertPayload?.profile?.profile_id, "onboard-site");
  assert.equal(authUpsertPayload?.profile?.allowed_origins?.[0], "https://onboard.example");
  if (process.platform !== "win32") {
    assert.equal(authUpsertPayload?.profile?.file_mode, "600");
  }
  assert.equal(authUpsertPayload?.profile?.insecure_file_permissions, false);
  assert.equal(authUpsertPayload?.profile?.lifecycle?.last_status, "saved");
  assert.equal(authUpsertPayload?.profile?.lifecycle?.last_reason, "created");
  assert.equal(typeof authUpsertPayload?.profile?.lifecycle?.created_at, "string");
  assert.equal(JSON.stringify(authUpsertPayload).includes("onboard-user"), false);
  assert.equal(JSON.stringify(authUpsertPayload).includes("onboard-password"), false);
  const writtenProfilePath = path.join(tmpLoginProfileDir, "onboard-site.env");
  const writtenProfileStat = await fs.stat(writtenProfilePath);
  if (process.platform !== "win32") {
    assert.equal((writtenProfileStat.mode & 0o777).toString(8).padStart(3, "0"), "600");
  } else {
    assert.equal(writtenProfileStat.isFile(), true);
  }
  const writtenMetadataPath = path.join(tmpLoginProfileDir, "onboard-site.meta.json");
  const writtenMetadataStat = await fs.stat(writtenMetadataPath);
  if (process.platform !== "win32") {
    assert.equal((writtenMetadataStat.mode & 0o777).toString(8).padStart(3, "0"), "600");
  } else {
    assert.equal(writtenMetadataStat.isFile(), true);
  }

  const authUpsertExistsCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "upsert_profile",
        profile_id: "onboard-site",
        origin: "https://onboard.example",
        username: "onboard-user",
        password: "onboard-password",
        confirm_write: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authUpsertExistsCall?.result?.isError, true);
  const authUpsertExistsPayload = firstJsonContent(authUpsertExistsCall.result);
  assert.equal(authUpsertExistsPayload?.error_code, "INVALID_ARGUMENT");
  assert.equal(JSON.stringify(authUpsertExistsPayload).includes("onboard-password"), false);

  const authUpsertOverwriteCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "upsert_profile",
        profile_id: "onboard-site",
        origin: "https://onboard.example",
        username: "onboard-user",
        password: "onboard-password-2",
        confirm_write: true,
        overwrite: true,
      },
    },
    timeoutMs,
  );
  assert.equal(authUpsertOverwriteCall?.result?.isError, undefined);
  const authUpsertOverwritePayload = firstJsonContent(authUpsertOverwriteCall.result);
  assert.equal(authUpsertOverwritePayload?.status, "success");
  assert.equal(authUpsertOverwritePayload?.created, false);
  assert.equal(authUpsertOverwritePayload?.updated, true);
  assert.equal(authUpsertOverwritePayload?.profile?.lifecycle?.last_reason, "updated");
  assert.equal(JSON.stringify(authUpsertOverwritePayload).includes("onboard-password-2"), false);

  const authListAfterUpsertCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "list_profiles",
      },
    },
    timeoutMs,
  );
  assert.equal(authListAfterUpsertCall?.result?.isError, undefined);
  const authListAfterUpsertPayload = firstJsonContent(authListAfterUpsertCall.result);
  const onboardProfile = authListAfterUpsertPayload?.profiles?.find((entry) => entry?.profile_id === "onboard-site");
  assert.equal(onboardProfile?.lifecycle?.last_status, "saved");
  assert.equal(onboardProfile?.lifecycle?.last_reason, "updated");
  assert.equal(JSON.stringify(authListAfterUpsertPayload).includes("onboard-password-2"), false);

  const authTooManyProfilesCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "list_profiles",
        profiles_dir: tmpTooManyLoginProfileDir,
      },
    },
    timeoutMs,
  );
  assert.equal(authTooManyProfilesCall?.result?.isError, true);
  const authTooManyProfilesPayload = firstJsonContent(authTooManyProfilesCall.result);
  assert.equal(authTooManyProfilesPayload?.error_code, "INVALID_ARGUMENT");
  assert.equal(authTooManyProfilesPayload?.details?.reason, "too_many_profile_files");
  assert.equal(authTooManyProfilesPayload?.details?.max_profile_files, 200);

  const invalidAuthWrites = [
    {
      label: "wildcard origin",
      args: {
        action: "upsert_profile",
        profile_id: "wildcard-site",
        origin: "https://*.example.test",
        username: "u",
        password: "p",
        confirm_write: true,
      },
    },
    {
      label: "path traversal profile id",
      args: {
        action: "upsert_profile",
        profile_id: "../escape",
        origin: "https://escape.example",
        username: "u",
        password: "p",
        confirm_write: true,
      },
    },
    {
      label: "missing write confirmation",
      args: {
        action: "upsert_profile",
        profile_id: "no-confirm",
        origin: "https://confirm.example",
        username: "u",
        password: "p",
      },
    },
  ];
  await Promise.all(invalidAuthWrites.map(async (entry) => {
    const call = await rpc.call(
      "tools/call",
      {
        name: "browser_auth_ops",
        arguments: entry.args,
      },
      timeoutMs,
    );
    assert.equal(call?.result?.isError, true, `invalid auth write should fail: ${entry.label}`);
    assert.equal(JSON.stringify(firstJsonContent(call.result)).includes("onboard-password"), false);
  }));

  const authUnsupportedCall = await rpc.call(
    "tools/call",
    {
      name: "browser_auth_ops",
      arguments: {
        action: "read_passwords",
      },
    },
    timeoutMs,
  );
  assert.equal(authUnsupportedCall?.result?.isError, true);
  const authUnsupportedPayload = firstJsonContent(authUnsupportedCall.result);
  assert.equal(authUnsupportedPayload?.tool, "browser_auth_ops");
  assert.equal(authUnsupportedPayload?.error_code, "INVALID_ARGUMENTS");
}

export { assertAuthOpsContract };
