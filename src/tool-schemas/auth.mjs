const AUTH_TOOL_SCHEMAS = {
  browser_auth_ops: {
    description: "Profile-driven login helpers for TMWD managed tabs: list/validate local login profiles, inspect login pages, suggest or save repo-external local profiles, ensure an already-open tab is authenticated, or plan/perform explicitly confirmed CAPTCHA physical assist. Credentials are loaded from/saved to repo-external local profiles and never returned. Redacted lifecycle metadata may be stored in sidecar files. CAPTCHA/MFA/SSO-only/OAuth-popup pages return manual_required_* plus non-secret manual_context instead of continued automatic guessing; CAPTCHA contexts may include captcha_kind and a manual/native-physical captcha_assist policy with window/region screenshot boundaries.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list_profiles",
            "validate_profile",
            "inspect_login_page",
            "suggest_profile",
            "upsert_profile",
            "ensure_login",
            "plan_captcha_assist",
            "assist_captcha",
          ],
        },
        profile_id: {
          type: "string",
          description: "Profile id to use, or auto to select by exact origin allowlist.",
        },
        profiles_dir: {
          type: "string",
          description: "Optional repo-external profile directory. Defaults to ~/.codex/secrets/tmwd-login-profiles.",
        },
        url: {
          type: "string",
          description: "Optional target URL for dry-run planning or profile validation. ensure_login normally works on the selected tab/session.",
        },
        origin: {
          type: "string",
          description: "Exact http(s) origin for a profile write or suggestion, for example https://example.test.",
        },
        allowed_origins: {
          type: "array",
          items: { type: "string" },
          description: "Exact http(s) origins allowed to use this profile. Wildcards are rejected.",
        },
        allowed_origin: {
          type: "string",
          description: "Single exact http(s) origin allowed to use this profile.",
        },
        username: {
          type: "string",
          description: "Username to save with upsert_profile. Never returned by tool results.",
        },
        password: {
          type: "string",
          description: "Password to save with upsert_profile. Never returned by tool results.",
        },
        login_path_pattern: { type: "string" },
        login_path_patterns: {
          type: "array",
          items: { type: "string" },
        },
        username_selector: { type: "string" },
        password_selector: { type: "string" },
        submit_selector: { type: "string" },
        success_path_not: { type: "string" },
        success_text: { type: "string" },
        overwrite: {
          type: "boolean",
          default: false,
          description: "Allow upsert_profile to replace an existing profile file.",
        },
        confirm_write: {
          type: "boolean",
          default: false,
          description: "Required true for upsert_profile because it writes credentials to a local secret profile.",
        },
        dry_run: { type: "boolean", default: false },
        tab_id: { type: "string" },
        switch_tab_id: { type: "string" },
        session_id: { type: "string" },
        session_url_pattern: { type: "string" },
        workspace_key: {
          type: "string",
          description: "Optional managed-tab workspace key to echo in non-secret manual_context for handoff/resume.",
        },
        assist_target: {
          type: "string",
          enum: ["auto", "checkbox", "slider"],
          default: "auto",
          description: "CAPTCHA assist target type for planning/execution. Slider execution requires physical drag support and screen start/end coordinates supplied by caller or coordinate_transform estimates.",
        },
        physical_input_provider: {
          type: "string",
          enum: ["auto", "native-os", "ljq-ctrl"],
          default: "auto",
          description: "Optional physical-input provider preference for CAPTCHA assist planning/execution. auto prefers ljq-ctrl when it becomes executable, otherwise native-os.",
        },
        confirm_physical_input: {
          type: "boolean",
          default: false,
          description: "Required true for assist_captcha because it can send native physical mouse input.",
        },
        auto_screen_coordinates: {
          type: "boolean",
          default: false,
          description: "Use plan_captcha_assist coordinate_transform screen estimates for assist_captcha. Still requires confirm_auto_coordinates and confirm_physical_input.",
        },
        confirm_auto_coordinates: {
          type: "boolean",
          default: false,
          description: "Required true when assist_captcha uses auto_screen_coordinates because estimated screen pixels can be wrong.",
        },
        run_vision_correction: {
          type: "boolean",
          default: false,
          description: "For plan_captcha_assist/assist_captcha, capture only the CAPTCHA window/viewport region and run first-pass visual coordinate correction. Does not click or read CAPTCHA tokens.",
        },
        use_vision_corrected_coordinates: {
          type: "boolean",
          default: false,
          description: "For assist_captcha, use screen coordinates from run_vision_correction instead of raw browser metric estimates. Requires confirm_corrected_coordinates.",
        },
        confirm_corrected_coordinates: {
          type: "boolean",
          default: false,
          description: "Required true when assist_captcha uses vision-corrected coordinates because physical pixels can still be wrong.",
        },
        screen_x: {
          type: "number",
          description: "Caller-supplied screen pixel x coordinate for assist_captcha physical input.",
        },
        screen_y: {
          type: "number",
          description: "Caller-supplied screen pixel y coordinate for assist_captcha physical input.",
        },
        screen_to_x: {
          type: "number",
          description: "Caller-supplied screen pixel destination x coordinate for assist_captcha slider drag.",
        },
        screen_to_y: {
          type: "number",
          description: "Caller-supplied screen pixel destination y coordinate for assist_captcha slider drag.",
        },
        drag_duration_ms: {
          type: "number",
          minimum: 0,
          maximum: 10_000,
          description: "Optional physical drag duration for assist_captcha slider drag.",
        },
        drag_steps: {
          type: "number",
          minimum: 1,
          maximum: 240,
          description: "Optional physical drag interpolation step count for assist_captcha slider drag.",
        },
        window_title: {
          type: "string",
          description: "Optional native window title selector fallback used to activate the browser window before physical input when TMWD tabs.switch is unavailable.",
        },
        window_pid: {
          type: "number",
          description: "Optional native window pid selector fallback used to activate the browser window before physical input when TMWD tabs.switch is unavailable.",
        },
        window_active_confirmed: {
          type: "boolean",
          default: false,
          description: "Fallback caller assertion that the target browser window is already foregrounded if TMWD tabs.switch and native window selectors are unavailable.",
        },
        wait_after_ms: {
          type: "number",
          minimum: 5_000,
          maximum: 30_000,
          description: "Minimum wait after native CAPTCHA assist input before resume; defaults to 5000ms.",
        },
        tmwd_mode: { type: "string", enum: ["auto", "tmwd", "remote_cdp", "cdp"], default: "tmwd" },
        tmwd_transport: { type: "string", enum: ["auto", "ws", "link"], default: "auto" },
        tmwd_ws_endpoint: { type: "string" },
        tmwd_link_endpoint: { type: "string" },
        timeout_ms: { type: "number", minimum: 100, maximum: 120_000 },
      },
      required: ["action"],
    },
  },
};

export { AUTH_TOOL_SCHEMAS };
