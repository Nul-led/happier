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

/// Set by the thread that observed the core exit on its own.
///
/// After that, `ExitRequested` is the shell following the core down and must go
/// straight through. Before it, an `ExitRequested` is the person quitting the
/// app — an app-menu Quit or Cmd-Q — which is the same decision the window's
/// close button asks, so it is routed to the controller instead of killing a
/// running Session behind the user's back. Signals stay forced cleanup.
static RUNNER_CORE_TERMINATED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

const RUNNER_CORE_TERMINATION_GRACE: Duration = Duration::from_secs(2);

/// Set once the core has been started, or once the shell began tearing down.
///
/// The core is started only when the renderer reports that its listeners are
/// installed: Tauri delivers an event only to listeners that already exist, so
/// a folder or failure question the core printed before the page subscribed
/// would be dropped while the core waits for its answer. Readiness can arrive
/// more than once (a page reload); only the first starts the one core.
static RUNNER_CORE_STARTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// The activation file this shell was launched for.
struct RunnerLaunch(PathBuf);

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

/// Forwards the core's stdout as whole `\n`-terminated lines.
///
/// An OS read boundary falls wherever the kernel put it, so decoding each raw
/// chunk with `from_utf8_lossy` replaces any multibyte character split across
/// two reads with U+FFFD before the renderer ever sees it. The web side already
/// parses complete JSON lines, so buffering bytes and decoding once per line is
/// both lossless and the shape the consumer wants. A trailing unterminated
/// remainder is still emitted at EOF rather than dropped.
fn forward_core_stdout(reader: &mut impl std::io::Read, mut emit: impl FnMut(String)) {
    let mut bytes = [0_u8; 8 * 1024];
    let mut buffer: Vec<u8> = Vec::new();
    while let Ok(count) = reader.read(&mut bytes) {
        if count == 0 {
            break;
        }
        buffer.extend_from_slice(&bytes[..count]);
        while let Some(index) = buffer.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = buffer.drain(..=index).collect();
            emit(String::from_utf8_lossy(&line).to_string());
        }
    }
    if !buffer.is_empty() {
        emit(String::from_utf8_lossy(&buffer).to_string());
    }
}

fn terminate_runner_core(app: &tauri::AppHandle) {
    // A readiness signal that arrives during teardown must not start a core.
    RUNNER_CORE_STARTED.store(true, std::sync::atomic::Ordering::SeqCst);
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

/// Spawns the one core and forwards its streams. The core slot stays locked
/// across the spawn so a concurrent teardown either finds the process or runs
/// before it exists (and then prevents it, above).
fn start_runner_core(
    app: &tauri::AppHandle,
    core: &RunnerCore,
    activation: &std::path::Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut slot = core.0.lock().map_err(|_| "runner_core_lock_failed")?;
    let mut command = app.shell().sidecar("happier-runner-core")?.env_clear();
    for (name, value) in runner_core_environment() {
        command = command.env(name, value);
    }
    let command = command
        .env("HAPPIER_RUNNER_NATIVE_SHELL", "stdio")
        .env("HAPPIER_RUNNER_ACTIVATION_FILE", activation);
    let mut command: std::process::Command = command.into();
    let SpawnedProcessTree {
        process,
        mut stdout,
        mut stderr,
    } = ProcessTree::spawn(&mut command)?;
    let waiter = process.waiter();
    *slot = Some(process);
    drop(slot);

    let stdout_handle = app.clone();
    std::thread::spawn(move || {
        forward_core_stdout(&mut stdout, |line| {
            let _ = stdout_handle.emit("runner-core-stdout", line);
        });
    });

    // The core only ever writes the safe recovery sentence here.
    // Forwarding it keeps a terminal launch truthful instead of
    // swallowing the one actionable line.
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut stderr, &mut std::io::stderr());
    });

    let handle = app.clone();
    std::thread::spawn(move || {
        let status = waiter.wait().ok();
        let code = status.and_then(|status| status.code());
        RUNNER_CORE_TERMINATED.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = handle.emit("runner-core-terminated", code);
        handle.exit(code.unwrap_or(1));
    });
    Ok(())
}

/// The renderer has awaited both core listeners; only now can the core's first
/// question reach it.
#[tauri::command]
fn runner_renderer_ready(
    app: tauri::AppHandle,
    core: tauri::State<'_, RunnerCore>,
    launch: tauri::State<'_, RunnerLaunch>,
) {
    if RUNNER_CORE_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    if start_runner_core(&app, &core, &launch.0).is_err() {
        eprintln!("{SAFE_STARTUP_FAILURE}");
        RUNNER_CORE_TERMINATED.store(true, std::sync::atomic::Ordering::SeqCst);
        app.exit(1);
    }
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
            runner_core_send,
            runner_renderer_ready
        ])
        .setup(move |app| {
            app.manage(RunnerCore(std::sync::Mutex::new(None)));
            app.manage(RunnerLaunch(activation.clone()));
            watch_termination_signals(app.handle());
            Ok(())
        })
        .build(context)
        .expect("failed to build Happier Runner shell")
        .run(|app, event| match event {
            // Before the core exists there is no Session and no controller to
            // ask, so closing the window simply closes the shell.
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } if label == "main"
                && RUNNER_CORE_STARTED.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                api.prevent_close();
                let _ = app.emit("runner-window-close-requested", ());
            }
            // A user-initiated quit asks the controller the same question the
            // window's close button does; the core decides whether the Session
            // keeps running. Once the core has exited on its own, the shell is
            // following it down and must not be held open.
            RunEvent::ExitRequested { api, .. }
                if RUNNER_CORE_STARTED.load(std::sync::atomic::Ordering::SeqCst)
                    && !RUNNER_CORE_TERMINATED.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                api.prevent_exit();
                let _ = app.emit("runner-window-close-requested", ());
            }
            // `handle.exit(..)` after a core exit, a signal and a core crash all
            // end here. The Bun core is never left orphaned holding a live
            // Session credential.
            RunEvent::ExitRequested { .. } | RunEvent::Exit => terminate_runner_core(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reader that hands out exactly the chunks it was given, so a multibyte
    /// character can be split across two OS reads the way a pipe really does.
    struct ChunkedReader {
        chunks: std::collections::VecDeque<Vec<u8>>,
    }

    impl std::io::Read for ChunkedReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            let Some(mut chunk) = self.chunks.pop_front() else {
                return Ok(0);
            };
            let take = chunk.len().min(out.len());
            out[..take].copy_from_slice(&chunk[..take]);
            if take < chunk.len() {
                chunk.drain(..take);
                self.chunks.push_front(chunk);
            }
            Ok(take)
        }
    }

    fn collect(chunks: Vec<Vec<u8>>) -> Vec<String> {
        let mut reader = ChunkedReader {
            chunks: chunks.into_iter().collect(),
        };
        let mut lines = Vec::new();
        forward_core_stdout(&mut reader, |line| lines.push(line));
        lines
    }

    #[test]
    fn preserves_a_multibyte_character_split_across_reads() {
        let line = "{\"v\":1,\"text\":\"héllo — wörld 😀\"}\n";
        let bytes = line.as_bytes().to_vec();
        for split in 1..bytes.len() {
            let emitted = collect(vec![bytes[..split].to_vec(), bytes[split..].to_vec()]);
            assert_eq!(emitted, vec![line.to_string()], "split at {split}");
        }
    }

    #[test]
    fn emits_whole_lines_and_the_unterminated_remainder() {
        let emitted = collect(vec![b"one\ntw".to_vec(), b"o\nthree".to_vec()]);
        assert_eq!(
            emitted,
            vec!["one\n".to_string(), "two\n".to_string(), "three".to_string()],
        );
    }
}
