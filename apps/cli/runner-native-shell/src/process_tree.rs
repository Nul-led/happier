use shared_child::SharedChild;
use std::io::{self, Write};
use std::process::{ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(windows)]
use std::os::windows::{io::AsRawHandle, process::CommandExt};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{
            OpenThread, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, THREAD_SUSPEND_RESUME,
        },
    },
};

/// The platform containment boundary for the Bun core and every Agent/tool it
/// launches. Callers know only how to write, wait, and terminate the tree.
pub struct ProcessTree {
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
    containment: ProcessContainment,
}

pub struct SpawnedProcessTree {
    pub process: ProcessTree,
    pub stdout: ChildStdout,
    pub stderr: ChildStderr,
}

#[derive(Clone)]
pub struct ProcessTreeWaiter(Arc<SharedChild>);

impl ProcessTreeWaiter {
    pub fn wait(&self) -> io::Result<ExitStatus> {
        self.0.wait()
    }
}

impl ProcessTree {
    pub fn spawn(command: &mut Command) -> io::Result<SpawnedProcessTree> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        command.process_group(0);

        #[cfg(windows)]
        {
            // The Bun core cannot execute (and therefore cannot launch an
            // escaping descendant) until it has been assigned to the job.
            command.creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
        }

        #[cfg(windows)]
        let job = WindowsJob::create()?;

        let mut child = command.spawn()?;

        #[cfg(windows)]
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }

        #[cfg(windows)]
        if let Err(error) = resume_suspended_process(child.id()) {
            let _ = job.terminate();
            let _ = child.wait();
            return Err(error);
        }

        let stdin = child.stdin.take().ok_or_else(|| missing_pipe("stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| missing_pipe("stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| missing_pipe("stderr"))?;
        let child = Arc::new(SharedChild::new(child)?);

        #[cfg(unix)]
        let containment = ProcessContainment::UnixGroup(child.id() as i32);
        #[cfg(windows)]
        let containment = ProcessContainment::WindowsJob(job);
        #[cfg(not(any(unix, windows)))]
        let containment = ProcessContainment::Direct;

        Ok(SpawnedProcessTree {
            process: Self {
                child,
                stdin: Mutex::new(Some(stdin)),
                containment,
            },
            stdout,
            stderr,
        })
    }

    pub fn waiter(&self) -> ProcessTreeWaiter {
        ProcessTreeWaiter(self.child.clone())
    }

    pub fn write(&self, bytes: &[u8]) -> io::Result<()> {
        let mut guard = self
            .stdin
            .lock()
            .map_err(|_| io::Error::other("runner core stdin lock poisoned"))?;
        guard
            .as_mut()
            .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "runner core stdin closed"))?
            .write_all(bytes)
    }

    /// End the shell carrier, request graceful termination for the complete
    /// containment boundary, then force that same boundary after the deadline.
    /// Normal endpoint Stop remains the Bun core's protocol-owned path and will
    /// ordinarily have emptied the boundary before this fallback runs.
    pub fn terminate(&self, grace: Duration) -> io::Result<()> {
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
        self.containment.request_graceful()?;
        if !wait_until(grace, || {
            // Reap an exited group leader while descendants finish. Otherwise
            // the zombie remains addressable and makes an empty Unix process
            // group look live until the full grace period has elapsed.
            let _ = self.child.try_wait()?;
            self.containment.is_empty()
        })? {
            self.containment.force_terminate()?;
            let _ = wait_until(Duration::from_secs(1), || self.containment.is_empty());
        }
        let _ = self.child.wait();
        Ok(())
    }
}

fn missing_pipe(name: &str) -> io::Error {
    io::Error::other(format!("runner core {name} pipe unavailable"))
}

fn wait_until(grace: Duration, mut complete: impl FnMut() -> io::Result<bool>) -> io::Result<bool> {
    let deadline = Instant::now() + grace;
    loop {
        if complete()? {
            return Ok(true);
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok(false);
        }
        sleep((deadline - now).min(Duration::from_millis(10)));
    }
}

enum ProcessContainment {
    #[cfg(unix)]
    UnixGroup(i32),
    #[cfg(windows)]
    WindowsJob(WindowsJob),
    #[cfg(not(any(unix, windows)))]
    Direct,
}

impl ProcessContainment {
    fn request_graceful(&self) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            Self::UnixGroup(pgid) => signal_unix_group(*pgid, libc::SIGTERM),
            #[cfg(windows)]
            Self::WindowsJob(_) => Ok(()),
            #[cfg(not(any(unix, windows)))]
            Self::Direct => Ok(()),
        }
    }

    fn force_terminate(&self) -> io::Result<()> {
        match self {
            #[cfg(unix)]
            Self::UnixGroup(pgid) => signal_unix_group(*pgid, libc::SIGKILL),
            #[cfg(windows)]
            Self::WindowsJob(job) => job.terminate(),
            #[cfg(not(any(unix, windows)))]
            Self::Direct => Ok(()),
        }
    }

    fn is_empty(&self) -> io::Result<bool> {
        match self {
            #[cfg(unix)]
            Self::UnixGroup(pgid) => unix_group_is_empty(*pgid),
            #[cfg(windows)]
            Self::WindowsJob(job) => job.is_empty(),
            #[cfg(not(any(unix, windows)))]
            Self::Direct => Ok(false),
        }
    }
}

#[cfg(unix)]
fn signal_unix_group(pgid: i32, signal: i32) -> io::Result<()> {
    if unsafe { libc::kill(-pgid, signal) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(unix)]
fn unix_group_is_empty(pgid: i32) -> io::Result<bool> {
    if unsafe { libc::kill(-pgid, 0) } == 0 {
        return Ok(false);
    }
    let error = io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ESRCH) => Ok(true),
        Some(libc::EPERM) => Ok(false),
        _ => Err(error),
    }
}

#[cfg(windows)]
struct WindowsJob(HANDLE);

#[cfg(windows)]
impl WindowsJob {
    fn create() -> io::Result<Self> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = Self(handle);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                std::ptr::addr_of!(limits).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }

    fn assign(&self, child: &std::process::Child) -> io::Result<()> {
        let assigned = unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) };
        if assigned == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn is_empty(&self) -> io::Result<bool> {
        let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        let queried = unsafe {
            QueryInformationJobObject(
                self.0,
                JobObjectBasicAccountingInformation,
                std::ptr::addr_of_mut!(accounting).cast(),
                std::mem::size_of_val(&accounting) as u32,
                std::ptr::null_mut(),
            )
        };
        if queried == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(accounting.ActiveProcesses == 0)
        }
    }

    fn terminate(&self) -> io::Result<()> {
        if unsafe { TerminateJobObject(self.0, 1) } == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(windows)]
fn resume_suspended_process(process_id: u32) -> io::Result<()> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let snapshot = WindowsHandle(snapshot);
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    if unsafe { Thread32First(snapshot.0, &mut entry) } == 0 {
        return Err(io::Error::last_os_error());
    }
    loop {
        if entry.th32OwnerProcessID == process_id {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if thread.is_null() {
                return Err(io::Error::last_os_error());
            }
            let thread = WindowsHandle(thread);
            if unsafe { ResumeThread(thread.0) } == u32::MAX {
                return Err(io::Error::last_os_error());
            }
            return Ok(());
        }
        if unsafe { Thread32Next(snapshot.0, &mut entry) } == 0 {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "runner core suspended thread unavailable",
            ));
        }
    }
}

#[cfg(windows)]
struct WindowsHandle(HANDLE);

#[cfg(windows)]
impl Drop for WindowsHandle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}
