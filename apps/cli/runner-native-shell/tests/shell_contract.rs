//! Source-level contract for the signed Linux/macOS Runner shell.
//!
//! The release owner separately re-derives the packaging-critical facts from
//! `tauri.conf.json` (see `scripts/pipeline/release/runner-native-shell.test.mjs`)
//! because those decide the published archive layout. This suite keeps the
//! endpoint-visible behavior of the crate honest.

fn config() -> serde_json::Value {
    serde_json::from_str(include_str!("../tauri.conf.json")).unwrap()
}

#[test]
fn shell_is_a_closed_linux_macos_host_for_the_runner_core() {
    let config = config();
    assert_eq!(config["productName"], "Happier Runner");
    assert_eq!(config["mainBinaryName"], "happier-runner");
    assert_eq!(config["identifier"], "dev.happier.runner");
    assert_eq!(
        config["bundle"]["externalBin"][0],
        "binaries/happier-runner-core"
    );
    assert_eq!(
        config["bundle"]["targets"],
        serde_json::json!(["app", "appimage"])
    );
    assert_eq!(config["app"]["withGlobalTauri"], true);
    assert!(config["app"]["security"]["csp"]
        .as_str()
        .unwrap()
        .contains("default-src 'self'"));
}

#[test]
fn macos_bundle_declares_the_trust_metadata_gatekeeper_needs() {
    let config = config();
    assert_eq!(config["bundle"]["macOS"]["hardenedRuntime"], true);
    assert!(config["bundle"]["macOS"]["minimumSystemVersion"].is_string());
    // Release signing is owned by the release pipeline so the nested Bun core
    // can receive the JIT entitlement the outer shell must not carry.
    assert!(config["bundle"]["macOS"]["signingIdentity"].is_null());
    assert!(config["bundle"]["icon"]
        .as_array()
        .unwrap()
        .iter()
        .any(|icon| icon == "icons/icon.icns"));
}

#[test]
fn no_installer_updater_or_service_target_is_bundled() {
    let config = config();
    let targets: Vec<String> = config["bundle"]["targets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect();
    for forbidden in ["nsis", "msi", "deb", "rpm", "dmg", "all"] {
        assert!(
            !targets.iter().any(|target| target == forbidden),
            "{forbidden} is not a one-shot Runner target"
        );
    }
    assert!(config["plugins"]["updater"].is_null());
}

#[test]
fn static_shell_keeps_accessibility_and_close_stop_contract_visible() {
    let html = include_str!("../web/index.html");
    let css = include_str!("../web/style.css");
    let script = include_str!("../web/main.js");
    assert!(html.contains("aria-live=\"polite\""));
    assert!(html.contains("aria-live=\"assertive\""));
    assert!(html.contains("tabindex=\"-1\""));
    assert!(css.contains("prefers-reduced-motion"));
    assert!(css.contains("forced-colors"));
    assert!(script.contains("runner-window-close-requested"));
    // `directory: null` is the endpoint's explicit activation-cancel answer. The
    // one place that may send it is the explicit cancel control; a cancelled
    // system dialog decides nothing and returns to the same folder choice.
    assert_eq!(script.matches("directory:null").count(), 1);
    assert!(script.contains("chooseFolder(id,chooser,true)"));
    // The shell renders the shared projections the core sends — the consent
    // review, then the phase-appropriate quiet facts. Reaching into raw manifest
    // fields here is how the native surface silently lost facts the terminal
    // showed, or kept consent-only facts the running surface must not show.
    assert!(script.contains("review.sections"));
    assert!(script.contains("presentation.facts"));
    assert!(!script.contains("preparedAuthoring"));
    assert!(script.contains("decision:'decline'"));
    assert!(script.contains("decision:'allow'"));
    // Every visible label is core-resolved endpoint copy. A literal here would
    // make the signed shell a second copy owner that no copy or locale change
    // could reach, which is how the endpoint stayed English-only.
    for label in [
        "chooser.chooseLabel",
        "chooser.homeLabel",
        "chooser.cancelLabel",
        "chooser.dialogTitle",
        "r.confirm.keepOpenLabel",
        "r.confirm.stopLabel",
        "r.recovery.retryLabel",
        "r.recovery.exitLabel",
        "action.label",
    ] {
        assert!(script.contains(label), "{label} must come from the core");
    }
    for literal in [
        "Stop Session",
        "Choose folder",
        "Use home folder",
        "Cancel request",
        "Keep open",
        "'Retry'",
        "'Exit'",
    ] {
        assert!(
            !script.contains(literal),
            "{literal} is endpoint copy and belongs to the core presentation owner"
        );
    }
    // The window's own first paint must not restate a lifecycle fact the core
    // has not published yet.
    assert!(!html.contains("Connecting to Home"));
    // Decline must be reachable before Allow so Allow is never the pre-focused
    // default of the consent step.
    assert!(script.find("decision:'decline'").unwrap() < script.find("decision:'allow'").unwrap());
}

#[test]
fn sidecar_environment_is_allowlisted_and_omits_credentials_and_bun_config() {
    let source = include_str!("../src/main.rs");
    assert!(source.contains(".env_clear()"));
    assert!(source.contains("RUNNER_CORE_ENV_ALLOWLIST"));
    assert!(source.contains("!name.starts_with(\"BUN_\")"));
    let allowlist = source
        .split("RUNNER_CORE_ENV_ALLOWLIST")
        .nth(1)
        .unwrap()
        .split("];")
        .next()
        .unwrap();
    for forbidden in [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "BUN_BE_BUN",
        "BUN_CONFIG_VERBOSE_FETCH",
        "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
    ] {
        assert!(!allowlist.contains(forbidden));
    }
}

#[test]
fn startup_refuses_unknown_arguments_and_a_missing_activation_before_any_window() {
    let source = include_str!("../src/main.rs");
    assert!(source.contains("Happier Runner could not continue. Open Happier for details."));
    // Both refusals precede `tauri::Builder`, so a headless endpoint and release
    // admission observe the same truthful non-zero exit.
    let builder = source.find("tauri::Builder::default()").unwrap();
    assert!(source.find("if !activation.is_file()").unwrap() < builder);
    assert!(source.find("resolve_activation_argument").unwrap() < builder);
    assert!(source.contains("value.starts_with('-')"));
}

#[test]
fn the_runner_core_is_terminated_on_every_shell_exit_path() {
    let source = include_str!("../src/main.rs");
    let process_tree = include_str!("../src/process_tree.rs");
    assert!(source
        .contains("RunEvent::ExitRequested { .. } | RunEvent::Exit => terminate_runner_core(app)"));
    assert!(source.contains("SignalKind::interrupt()"));
    assert!(source.contains("SignalKind::terminate()"));
    assert!(source.contains("SignalKind::hangup()"));
    assert!(source.contains("ProcessTree::spawn"));
    assert!(source.contains("process.terminate(RUNNER_CORE_TERMINATION_GRACE)"));
    assert!(process_tree.contains("command.process_group(0)"));
    assert!(process_tree.contains("libc::SIGTERM"));
    assert!(process_tree.contains("libc::SIGKILL"));
    assert!(process_tree.contains("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE"));
    assert!(process_tree.contains("TerminateJobObject"));
    assert!(process_tree.contains("CREATE_SUSPENDED"));
    assert!(process_tree.contains("CREATE_NO_WINDOW"));
    assert!(process_tree.contains("ResumeThread"));
    assert!(!source.contains("child.kill()"));
}
