use std::sync::Arc;

use russh::ChannelMsg;
use tokio::sync::watch;
use tokio::time::{timeout, Duration};

use crate::auth::authenticate;
use crate::cancellation::{cancellation_error, wait_for_cancellation};
use crate::connection::connect;
use crate::error::NativeSshError;
use crate::host_key::HostKeyPrompter;
use crate::types::{NativeSshAuthContext, NativeSshExecRequest, NativeSshExecResult};

// Matches the existing HappierJsonExecutor process-input contract. The native
// transport enforces the same boundary rather than introducing another limit.
const MAX_EXEC_INPUT_BYTES: usize = 64 * 1024;
// Matches cli-common's existing OpenSSH runner contract for each output stream.
const MAX_EXEC_OUTPUT_BYTES: usize = 1024 * 1024;

pub trait ExecOutputSink: Send + Sync {
    fn stdout_chunk(&self, request_id: &str, chunk: &str);
}

pub struct NoopExecOutputSink;

impl ExecOutputSink for NoopExecOutputSink {
    fn stdout_chunk(&self, _request_id: &str, _chunk: &str) {}
}

#[derive(Default)]
struct ExecOutputAccumulator {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    stdout_utf8_carry: Vec<u8>,
}

impl ExecOutputAccumulator {
    fn append_stdout(
        &mut self,
        request_id: &str,
        data: &[u8],
        output_sink: &dyn ExecOutputSink,
    ) -> Result<(), NativeSshError> {
        ensure_output_capacity(self.stdout.len(), data.len())?;
        self.stdout.extend_from_slice(data);
        self.stdout_utf8_carry.extend_from_slice(data);
        self.emit_complete_stdout(request_id, output_sink);
        Ok(())
    }

    fn append_stderr(&mut self, data: &[u8]) -> Result<(), NativeSshError> {
        ensure_output_capacity(self.stderr.len(), data.len())?;
        self.stderr.extend_from_slice(data);
        Ok(())
    }

    fn emit_complete_stdout(&mut self, request_id: &str, output_sink: &dyn ExecOutputSink) {
        loop {
            match std::str::from_utf8(&self.stdout_utf8_carry) {
                Ok(text) => {
                    if !text.is_empty() {
                        output_sink.stdout_chunk(request_id, text);
                    }
                    self.stdout_utf8_carry.clear();
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        let text = String::from_utf8_lossy(&self.stdout_utf8_carry[..valid_up_to]);
                        output_sink.stdout_chunk(request_id, &text);
                        self.stdout_utf8_carry.drain(..valid_up_to);
                    }
                    let Some(error_len) = error.error_len() else {
                        return;
                    };
                    let replacement = String::from_utf8_lossy(&self.stdout_utf8_carry[..error_len]);
                    output_sink.stdout_chunk(request_id, &replacement);
                    self.stdout_utf8_carry.drain(..error_len);
                }
            }
        }
    }

    fn finish_stdout(&mut self, request_id: &str, output_sink: &dyn ExecOutputSink) {
        if !self.stdout_utf8_carry.is_empty() {
            let text = String::from_utf8_lossy(&self.stdout_utf8_carry);
            output_sink.stdout_chunk(request_id, &text);
            self.stdout_utf8_carry.clear();
        }
    }
}

fn ensure_output_capacity(current: usize, additional: usize) -> Result<(), NativeSshError> {
    if current
        .checked_add(additional)
        .is_none_or(|total| total > MAX_EXEC_OUTPUT_BYTES)
    {
        return Err(NativeSshError::new(
            "output-limit-exceeded",
            "Native SSH command output exceeds the supported size.",
        ));
    }
    Ok(())
}

fn validate_exec_input(input: Option<&str>) -> Result<(), NativeSshError> {
    if input.is_some_and(|value| value.len() > MAX_EXEC_INPUT_BYTES) {
        return Err(NativeSshError::new(
            "input-limit-exceeded",
            "Native SSH command input exceeds the supported size.",
        ));
    }
    Ok(())
}

pub async fn exec(
    request: NativeSshExecRequest,
    prompter: Arc<dyn HostKeyPrompter>,
    output_sink: Arc<dyn ExecOutputSink>,
    mut cancellation: watch::Receiver<bool>,
) -> Result<NativeSshExecResult, NativeSshError> {
    validate_exec_input(request.input.as_deref())?;
    let mut session = tokio::select! {
        _ = wait_for_cancellation(&mut cancellation) => return Err(cancellation_error()),
        result = connect(request.clone(), prompter) => result?,
    };
    let auth_context = auth_context_from_exec_request(&request);
    tokio::select! {
        _ = wait_for_cancellation(&mut cancellation) => return Err(cancellation_error()),
        result = timeout(
            Duration::from_millis(request.auth_timeout_ms.max(1)),
            authenticate(&mut session, &auth_context, &request.auth),
        ) => {
            result
                .map_err(|_| NativeSshError::new("authentication-failed", "Native SSH authentication timed out."))??;
        }
    }

    let exec_result = timeout(
        Duration::from_millis(request.exec_timeout_ms.max(1)),
        async {
            let mut channel = session.channel_open_session().await?;
            channel.exec(true, request.command.as_bytes()).await?;
            if let Some(input) = &request.input {
                channel.data(input.as_bytes()).await?;
            }
            channel.eof().await?;
            let mut output = ExecOutputAccumulator::default();
            let mut exit_code = None;
            while let Some(message) = channel.wait().await {
                match message {
                    ChannelMsg::Data { data } => {
                        output.append_stdout(&request.request_id, &data, output_sink.as_ref())?;
                    }
                    ChannelMsg::ExtendedData { data, .. } => output.append_stderr(&data)?,
                    ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status),
                    ChannelMsg::Eof => {}
                    _ => {}
                }
            }
            output.finish_stdout(&request.request_id, output_sink.as_ref());
            channel.close().await?;
            Ok::<_, NativeSshError>(NativeSshExecResult {
                exit_code,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                signal: None,
            })
        },
    );
    tokio::select! {
        _ = wait_for_cancellation(&mut cancellation) => Err(cancellation_error()),
        result = exec_result => result
            .map_err(|_| NativeSshError::new("exec-timeout", "Native SSH command timed out."))?
            ,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{
        validate_exec_input, ExecOutputAccumulator, ExecOutputSink, MAX_EXEC_INPUT_BYTES,
        MAX_EXEC_OUTPUT_BYTES,
    };

    #[derive(Default)]
    struct RecordingSink {
        chunks: Mutex<Vec<String>>,
    }

    impl ExecOutputSink for RecordingSink {
        fn stdout_chunk(&self, _request_id: &str, chunk: &str) {
            self.chunks
                .lock()
                .expect("chunks lock")
                .push(chunk.to_string());
        }
    }

    #[test]
    fn enforces_the_existing_happier_executor_input_boundary_in_bytes() {
        assert!(validate_exec_input(Some(&"a".repeat(MAX_EXEC_INPUT_BYTES))).is_ok());
        let error = validate_exec_input(Some(&"a".repeat(MAX_EXEC_INPUT_BYTES + 1)))
            .expect_err("oversized input must fail closed");
        assert_eq!(error.code, "input-limit-exceeded");

        assert!(validate_exec_input(Some(&"é".repeat(MAX_EXEC_INPUT_BYTES / 2))).is_ok());
        assert!(validate_exec_input(Some(&"é".repeat(MAX_EXEC_INPUT_BYTES / 2 + 1))).is_err());
    }

    #[test]
    fn accepts_exact_stdout_boundary_and_rejects_before_emitting_the_next_byte() {
        let sink = Arc::new(RecordingSink::default());
        let mut output = ExecOutputAccumulator::default();
        output
            .append_stdout(
                "request-1",
                &vec![b'a'; MAX_EXEC_OUTPUT_BYTES],
                sink.as_ref(),
            )
            .expect("exact output boundary");
        let emitted_before_error = sink.chunks.lock().expect("chunks lock").len();

        let error = output
            .append_stdout("request-1", b"b", sink.as_ref())
            .expect_err("stdout beyond the boundary must fail closed");

        assert_eq!(error.code, "output-limit-exceeded");
        assert_eq!(output.stdout.len(), MAX_EXEC_OUTPUT_BYTES);
        assert_eq!(
            sink.chunks.lock().expect("chunks lock").len(),
            emitted_before_error
        );
    }

    #[test]
    fn accepts_exact_stderr_boundary_and_rejects_the_next_byte() {
        let mut output = ExecOutputAccumulator::default();
        output
            .append_stderr(&vec![b'a'; MAX_EXEC_OUTPUT_BYTES])
            .expect("exact output boundary");
        let error = output
            .append_stderr(b"b")
            .expect_err("stderr beyond the boundary must fail closed");

        assert_eq!(error.code, "output-limit-exceeded");
        assert_eq!(output.stderr.len(), MAX_EXEC_OUTPUT_BYTES);
    }

    #[test]
    fn streams_one_utf8_code_point_split_across_channel_frames() {
        let sink = Arc::new(RecordingSink::default());
        let mut output = ExecOutputAccumulator::default();
        output
            .append_stdout("request-1", &[0xe2, 0x82], sink.as_ref())
            .unwrap();
        assert!(sink.chunks.lock().expect("chunks lock").is_empty());
        output
            .append_stdout("request-1", &[0xac], sink.as_ref())
            .unwrap();
        output.finish_stdout("request-1", sink.as_ref());

        assert_eq!(*sink.chunks.lock().expect("chunks lock"), vec!["€"]);
        assert_eq!(String::from_utf8(output.stdout).unwrap(), "€");
    }
}

fn auth_context_from_exec_request(request: &NativeSshExecRequest) -> NativeSshAuthContext {
    NativeSshAuthContext {
        request_id: request.request_id.clone(),
        host: request.host.clone(),
        port: request.port,
        username: request.username.clone(),
    }
}
