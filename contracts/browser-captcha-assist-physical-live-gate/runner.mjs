import { parseLastJsonLine, runPhysicalLiveChild } from "./child-runner.mjs";
import { parsePhysicalGateEnv } from "./env.mjs";
import { nativePointerPreflight } from "./pointer-preflight.mjs";
import { writePhysicalProof } from "./proof.mjs";
import {
  attachProofFailure,
  buildChildFailureResult,
  buildConfirmMissingResult,
  buildNativePointerMissingResult,
  buildPhysicalDisabledResult,
  buildPhysicalResult,
} from "./result.mjs";

async function runPhysicalLiveGate(options = {}) {
  const env = options.env ?? process.env;
  const flags = parsePhysicalGateEnv(env);
  if (!flags.physical_enabled) {
    return buildPhysicalDisabledResult(flags);
  }
  if (!flags.confirm_enabled) {
    return buildConfirmMissingResult();
  }

  const pointerPreflight = options.nativePointerPreflight ?? nativePointerPreflight;
  const nativePointer = await pointerPreflight({
    platform: options.platform ?? process.platform,
  });
  if (!nativePointer.ok) {
    return buildNativePointerMissingResult(nativePointer, flags);
  }

  const childRunner = options.runChild ?? runPhysicalLiveChild;
  const child = await childRunner(options.argv ?? [], {
    cwd: options.cwd ?? process.cwd(),
    env,
  });
  const parsed = parseLastJsonLine(child.stdout);
  if (child.status !== 0 || parsed?.ok !== true) {
    return buildChildFailureResult(child, parsed);
  }

  const result = buildPhysicalResult(parsed);
  if (!result.payload.ok) {
    return result;
  }

  const proofWriter = options.writePhysicalProof ?? writePhysicalProof;
  try {
    result.payload.proof = await proofWriter(parsed, {
      platform: options.platform ?? process.platform,
      proof_dir: env.TMWD_OPTIONAL_PROOF_DIR,
      write_proof_disabled: flags.write_proof_disabled,
    });
  } catch (error) {
    result.payload.proof = {
      written: false,
      error: error instanceof Error ? error.message : String(error),
    };
    if (flags.require_proof) {
      return attachProofFailure(result.payload, error);
    }
  }

  return result;
}

export { runPhysicalLiveGate };
