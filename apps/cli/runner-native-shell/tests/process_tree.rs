#![cfg(unix)]

#[path = "../src/process_tree.rs"]
mod process_tree;

use process_tree::ProcessTree;
use std::io::{BufRead, BufReader, Read};
use std::process::Command;
use std::thread::sleep;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn process_exists(pid: i32) -> bool {
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn unique_marker(name: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "happier-runner-{name}-{}-{nonce}",
        std::process::id()
    ))
}

#[test]
fn normal_stdio_stop_exits_without_forced_termination() {
    let mut command = Command::new("sh");
    command.args(["-c", "read line; printf '%s' \"$line\""]);
    let mut tree = ProcessTree::spawn(&mut command).expect("spawn process tree");
    let _ = &tree.stderr;
    let waiter = tree.process.waiter();

    tree.process
        .write(b"stop\n")
        .expect("write normal stop request");
    let mut response = String::new();
    tree.stdout
        .read_to_string(&mut response)
        .expect("read response");

    assert_eq!(response, "stop");
    assert!(waiter.wait().expect("wait for normal exit").success());
    tree.process
        .terminate(Duration::from_millis(100))
        .expect("repeated cleanup after normal stop is idempotent");
}

#[test]
fn shell_cleanup_requests_graceful_group_termination_before_force() {
    let marker = unique_marker("graceful");
    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg("trap 'printf graceful > \"$1\"; exit 0' TERM; echo ready; while :; do sleep 1; done")
        .arg("runner-process-tree-test")
        .arg(&marker);
    let tree = ProcessTree::spawn(&mut command).expect("spawn process tree");
    let _ = &tree.stderr;
    let mut ready = String::new();
    BufReader::new(tree.stdout)
        .read_line(&mut ready)
        .expect("wait until signal handler is installed");
    assert_eq!(ready.trim(), "ready");

    tree.process
        .terminate(Duration::from_secs(2))
        .expect("terminate process tree gracefully");

    assert_eq!(
        std::fs::read_to_string(&marker).expect("grace marker"),
        "graceful"
    );
    std::fs::remove_file(marker).expect("remove owned test marker");
}

#[test]
fn forced_termination_kills_a_descendant_that_ignores_graceful_shutdown() {
    let mut command = Command::new("sh");
    command.args([
        "-c",
        "trap '' TERM; sh -c 'trap \"\" TERM; echo $$; while :; do sleep 1; done' & wait",
    ]);
    let tree = ProcessTree::spawn(&mut command).expect("spawn process tree");
    let _ = &tree.stderr;
    let descendant_pid: i32 = {
        let mut line = String::new();
        BufReader::new(tree.stdout)
            .read_line(&mut line)
            .expect("read descendant pid");
        line.trim().parse().expect("parse descendant pid")
    };
    assert!(
        process_exists(descendant_pid),
        "descendant must be alive before shutdown"
    );

    tree.process
        .terminate(Duration::from_millis(100))
        .expect("terminate process tree");
    tree.process
        .terminate(Duration::from_millis(100))
        .expect("repeated forced cleanup is idempotent");

    let deadline = Instant::now() + Duration::from_secs(2);
    while process_exists(descendant_pid) && Instant::now() < deadline {
        sleep(Duration::from_millis(10));
    }
    assert!(
        !process_exists(descendant_pid),
        "forced shell shutdown left descendant {descendant_pid} alive",
    );
}
