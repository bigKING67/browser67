import { runPhysicalInputAction } from "../../physical-input/index.mjs";
import { finiteNumber } from "../captcha/coordinates.mjs";
import { CAPTCHA_ASSIST_REASONS } from "../captcha/reasons.mjs";
import {
  activateManagedTabForPhysicalInput,
  isSupportedWindowsBrowserProcess,
  resolveManagedTabNativeWindowTitle,
  resolveManagedTabNativeWindowUrl,
} from "./context.mjs";
import { assistBlocked } from "./outcome.mjs";

function blockedActivation(planned, activation, extras = {}) {
  return {
    ok: false,
    outcome: assistBlocked(planned, CAPTCHA_ASSIST_REASONS.MANAGED_TAB_ACTIVATION_FAILED, {
      ...(activation === undefined ? {} : { activation }),
      ...extras,
    }),
  };
}

async function activateInitialWindow(args, planned, managedTab) {
  const windowTitle = String(args?.window_title ?? "").trim();
  const windowPid = finiteNumber(args?.window_pid);
  if (windowTitle || windowPid !== null) {
    const activated = await runPhysicalInputAction("activate_window", {
      window_title: windowTitle || undefined,
      window_pid: windowPid ?? undefined,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: args?.physical_input_provider,
    });
    return {
      ok: true,
      activation: {
        provider_selection: activated.provider_selection,
        provider: activated.provider,
        ...activated.result,
      },
    };
  }

  try {
    return {
      ok: true,
      activation: await activateManagedTabForPhysicalInput(args, managedTab.tab_id),
    };
  } catch (error) {
    if (args?.window_active_confirmed === true) {
      return {
        ok: true,
        activation: {
          status: "confirmed_by_caller",
          tmwd_activation_error: String(error?.message ?? error),
        },
      };
    }
    return blockedActivation(planned, undefined, {
      activation_error: String(error?.message ?? error),
      required_one_of: [
        "TMWD tabs.switch on managed tab",
        "window_title",
        "window_pid",
        "window_active_confirmed:true",
      ],
    });
  }
}

async function foregroundDarwinManagedTab(args, planned, managedTab, activation) {
  const nativeWindowUrl = resolveManagedTabNativeWindowUrl(
    planned,
    activation,
    managedTab.managed_tab,
  );
  const nativeWindowTabId = finiteNumber(managedTab.tab_id ?? activation.tab_id);
  if (!nativeWindowUrl && nativeWindowTabId === null) {
    return blockedActivation(planned, {
      ...activation,
      native_window_activation: {
        status: "blocked",
        reason: "managed_tab_window_url_unavailable",
      },
    }, {
      required_one_of: [
        "managed tab page URL",
        "window_title",
        "window_pid",
      ],
    });
  }

  try {
    const nativeActivation = await runPhysicalInputAction("activate_window", {
      window_tab_id: nativeWindowTabId ?? undefined,
      window_url: nativeWindowUrl,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: "native-os",
    });
    const nativeActivationSucceeded = nativeActivation.result?.status === "success"
      && nativeActivation.result?.foregrounded === true;
    const nextActivation = {
      ...activation,
      status: nativeActivationSucceeded ? "foregrounded" : "activation_failed",
      os_foreground_verified: nativeActivationSucceeded,
      native_window_activation: {
        window_tab_id: nativeWindowTabId ?? undefined,
        window_url: nativeWindowUrl,
        provider_selection: nativeActivation.provider_selection,
        provider: nativeActivation.provider,
        ...nativeActivation.result,
      },
    };
    if (!nativeActivationSucceeded) {
      return blockedActivation(planned, nextActivation, {
        activation_error: "native Chromium tab activation did not reach the macOS foreground",
      });
    }
    return { ok: true, activation: nextActivation };
  } catch (error) {
    return blockedActivation(planned, {
      ...activation,
      status: "activation_failed",
      os_foreground_verified: false,
      native_window_activation: {
        status: "failed",
        window_tab_id: nativeWindowTabId ?? undefined,
        window_url: nativeWindowUrl,
        error: String(error?.message ?? error),
      },
    }, {
      activation_error: String(error?.message ?? error),
    });
  }
}

async function foregroundWindowsManagedTab(args, planned, managedTab, activation) {
  const nativeWindowTitle = resolveManagedTabNativeWindowTitle(
    planned,
    activation,
    managedTab.managed_tab,
  );
  if (!nativeWindowTitle) {
    return blockedActivation(planned, {
      ...activation,
      native_window_activation: {
        status: "blocked",
        reason: "managed_tab_window_title_unavailable",
      },
    }, {
      required_one_of: [
        "managed tab page title",
        "window_title",
        "window_pid",
      ],
    });
  }

  try {
    const nativeActivation = await runPhysicalInputAction("activate_window", {
      window_title: nativeWindowTitle,
      timeout_ms: args?.timeout_ms,
    }, {
      preferred_provider: "native-os",
    });
    const browserProcessVerified = isSupportedWindowsBrowserProcess(
      nativeActivation.result?.process_name,
    );
    const nativeActivationSucceeded = nativeActivation.result?.status === "success"
      && nativeActivation.result?.foregrounded === true
      && browserProcessVerified;
    const nextActivation = {
      ...activation,
      status: nativeActivationSucceeded ? "foregrounded" : "activation_failed",
      os_foreground_verified: nativeActivationSucceeded,
      native_window_activation: {
        window_title: nativeWindowTitle,
        provider_selection: nativeActivation.provider_selection,
        provider: nativeActivation.provider,
        ...nativeActivation.result,
        browser_process_verified: browserProcessVerified,
      },
    };
    if (!nativeActivationSucceeded) {
      return blockedActivation(planned, nextActivation, {
        activation_error: browserProcessVerified
          ? "native browser window activation did not reach the OS foreground"
          : `native window title resolved to unsupported process=${String(nativeActivation.result?.process_name ?? "unknown")}`,
      });
    }
    return { ok: true, activation: nextActivation };
  } catch (error) {
    return blockedActivation(planned, {
      ...activation,
      status: "activation_failed",
      os_foreground_verified: false,
      native_window_activation: {
        status: "failed",
        window_title: nativeWindowTitle,
        error: String(error?.message ?? error),
      },
    }, {
      activation_error: String(error?.message ?? error),
    });
  }
}

async function activateCaptchaTarget(args, planned, managedTab) {
  const initial = await activateInitialWindow(args, planned, managedTab);
  if (!initial.ok) return initial;

  const activation = initial.activation;
  if (activation.method !== "tmwd_tabs_switch") {
    return { ok: true, activation };
  }
  if (planned.native_input_capabilities?.platform === "darwin") {
    return foregroundDarwinManagedTab(args, planned, managedTab, activation);
  }
  if (planned.native_input_capabilities?.platform === "win32") {
    return foregroundWindowsManagedTab(args, planned, managedTab, activation);
  }
  return { ok: true, activation };
}

export {
  activateCaptchaTarget,
};
