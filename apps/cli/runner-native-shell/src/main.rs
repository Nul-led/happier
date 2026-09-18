mod process_tree;

use process_tree::{ProcessTree, SpawnedProcessTree};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

/// The endpoint never sees provider, prompt or path detail from a launch
/// failure. The Bun core prints the same sentence, and release admission
/// requires it on stderr before the activation-file boundary.
const SAFE_STARTUP_FAILURE: &str = "Happier Runner could not continue. Open Happier for details.";

struct RunnerCore(std::sync::Mutex<Option<ProcessTree>>);

const RUNNER_CORE_TERMINATION_GRACE: Duration = Duration::from_secs(2);

/// The Runner core inherits nothing it did not need. Everything outside this
/// list — provider credentials, agent tokens and every `BUN_*` variable that
/// could re-enter the embedded Bun dispatcher or preload ambient code — is
/// dropped by `env_clear()` before the child exists.
const RUNNER_CORE_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
];

fn runner_core_environment() -> Vec<(&'static str, std::ffi::OsString)> {
    RUNNER_CORE_ENV_ALLOWLIST
        .iter()
        .filter(|name| !name.starts_with("BUN_"))
        .filter_map(|name| std::env::var_os(name).map(|value| (*name, value)))
        .collect()
}

fn exit_with_safe_startup_failure() -> ! {
    eprintln!("{SAFE_STARTUP_FAILURE}");
    std::process::exit(1);
}

fn activation_path(argument: Option<PathBuf>) -> PathBuf {
    if let Some(path) = argument {
        return path;
    }
    let mut outer = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_default();
    #[cfg(target_os = "macos")]
    if outer
        .components()
        .any(|part| part.as_os_str() == "Contents")
    {
        while outer.file_name().is_some()
            && outer.extension().and_then(|v| v.to_str()) != Some("app")
        {
            outer.pop();
        }
    }
    outer
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("happier-runner.activation.json")
}

/// The shell is a one-shot activation host, not a command surface. It accepts a
/// lone version probe or a lone activation-file path; every other argument —
/// including an inherited Bun dispatcher flag such as `--eval` — is refused
/// before any window, sidecar or activation material exists.
fn resolve_activation_argument(args: Vec<std::ffi::OsString>, version: &str) -> PathBuf {
    if args.len() == 1 {
        let value = args[0].to_string_lossy().to_string();
        if value == "--version" || value == "-v" {
            println!("happier-runner {version}");
            std::process::exit(0);
        }
        if value.starts_with('-') {
            exit_with_safe_startup_failure();
        }
        return activation_path(Some(PathBuf::from(&args[0])));
    }
    if !args.is_empty() {
        exit_with_safe_startup_failure();
    }
    activation_path(None)
}

fn terminate_runner_core(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<RunnerCore>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(process) = guard.take() {
        let _ = process.terminate(RUNNER_CORE_TERMINATION_GRACE);
    }
}

#[cfg(unix)]
fn watch_termination_signals(app: &tauri::AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    for (kind, code) in [
        (SignalKind::interrupt(), 130),
        (SignalKind::terminate(), 143),
        (SignalKind::hangup(), 129),
    ] {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(mut stream) = signal(kind) else { return };
            if stream.recv().await.is_some() {
                terminate_runner_core(&handle);
                handle.exit(code);
            }
        });
    }
}

#[cfg(not(unix))]
fn watch_termination_signals(_app: &tauri::AppHandle) {}

#[tauri::command]
fn runner_home_directory() -> Result<String, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .and_then(|value| value.into_string().ok())
        .ok_or_else(|| "home_directory_unavailable".to_string())
}

#[tauri::command]
/// The dialog title is endpoint copy owned by the runner core's one presentation
/// owner, not by this shell, so the operating system's own chrome follows the
/// same copy as everything inside the window.
async fn runner_pick_directory(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .pick_folder(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    rx.await.map_err(|_| "folder_dialog_closed".to_string())
}

#[tauri::command]
fn runner_core_send(core: tauri::State<'_, RunnerCore>, line: String) -> Result<(), String> {
    let mut bytes = line.into_bytes();
    bytes.push(b'\n');
    let guard = core
        .0
        .lock()
        .map_err(|_| "runner_core_lock_failed".to_string())?;
    guard
        .as_ref()
        .ok_or_else(|| "runner_core_unavailable".to_string())?
        .write(&bytes)
        .map_err(|_| "runner_core_write_failed".to_string())
}

fn main() {
    let context = tauri::generate_context!();
    let version = context.package_info().version.to_string();
    let activation = resolve_activation_argument(std::env::args_os().skip(1).collect(), &version);
    // A Runner without its adjacent activation file cannot claim, review or run
    // anything. Failing here keeps the refusal truthful on a headless endpoint
    // and is the boundary release admission observes.
    if !activation.is_file() {
        exit_with_safe_startup_failure();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            runner_pick_directory,
            runner_home_directory,
            runner_core_send
        ])
        .setup(move |app| {
            let mut command = app.shell().sidecar("happier-runner-core")?.env_clear();
            for (name, value) in runner_core_environment() {
                command = command.env(name, value);
            }
            let command = command
                .env("HAPPIER_RUNNER_NATIVE_SHELL", "stdio")
                .env("HAPPIER_RUNNER_ACTIVATION_FILE", activation.clone());
            let mut command: std::process::Command = command.into();
            let SpawnedProcessTree {
                process,
                mut stdout,
                mut stderr,
            } = ProcessTree::spawn(&mut command)?;
            let waiter = process.waiter();
            app.manage(RunnerCore(std::sync::Mutex::new(Some(process))));
            watch_termination_signals(app.handle());

            let stdout_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut bytes = [0_u8; 8 * 1024];
                while let Ok(count) = stdout.read(&mut bytes) {
                    if count == 0 {
                        break;
                    }
                    let _ = stdout_handle.emit(
                        "runner-core-stdout",
                        String::from_utf8_lossy(&bytes[..count]).to_string(),
                    );
                }
            });

            // The core only ever writes the safe recovery sentence here.
            // Forwarding it keeps a terminal launch truthful instead of
            // swallowing the one actionable line.
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut stderr, &mut std::io::stderr());
            });

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let status = waiter.wait().ok();
                let code = status.and_then(|status| status.code());
                let _ = handle.emit("runner-core-terminated", code);
                handle.exit(code.unwrap_or(1));
            });
            Ok(())
        })
        .build(context)
        .expect("failed to build Happier Runner shell")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                let _ = app.emit("runner-window-close-requested", ());
            }
            // Window close, `handle.exit(..)`, a signal and a core crash all end
            // here. The Bun core is never left orphaned holding a live Session
            // credential.
            RunEvent::ExitRequested { .. } | RunEvent::Exit => terminate_runner_core(app),
            _ => {}
        });
}
