import type { AgentInstallJobEvent, AgentInstallJobOutcome, DaemonAgentInstallStartRequest } from '@happier-dev/protocol/daemon/agent-install-jobs';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemonAgentInstallJob, readDaemonAgentInstallJob, cancelDaemonAgentInstallJob } from '@/daemon/agentInstallJobClient';

export type LocalAgentInstallJobResult =
  | { ok: true; jobId: string; outcome: AgentInstallJobOutcome }
  | { ok: false; errorCode: string; error: string };

export async function waitForLocalAgentInstallJob(input: {
  request: DaemonAgentInstallStartRequest;
  target?: Readonly<{ pid: number; httpPort: number; controlToken?: string }>;
  onEvent?: (event: AgentInstallJobEvent) => void;
}): Promise<LocalAgentInstallJobResult> {
  let interrupted = false;
  let jobId: string | null = null;
  const cancellation: { promise: ReturnType<typeof cancelDaemonAgentInstallJob> | null } = { promise: null };
  const controller = new AbortController();
  const cancel = () => {
    interrupted = true;
    controller.abort();
    if (jobId && !cancellation.promise) cancellation.promise = cancelDaemonAgentInstallJob({ jobId }, { target: input.target });
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    // Do not abort start: the acknowledgement contains the identity needed to
    // cancel a job that was accepted while the user interrupted the request.
    const started = await startDaemonAgentInstallJob(input.request, { target: input.target });
    if (!started.ok) return started;
    jobId = started.jobId;
    if (interrupted) cancel();
    let cursor = 0;
    for (;;) {
      if (cancellation.promise) {
        const result = await cancellation.promise;
        if (!result.ok) return result;
      }
      const read = await readDaemonAgentInstallJob({ jobId, cursor }, { target: input.target });
      if (!read.ok) return read;
      for (const event of read.events) input.onEvent?.(event);
      cursor = read.nextCursor;
      if (read.done) {
        if (!read.outcome) return { ok: false, errorCode: 'invalid_daemon_response', error: 'The daemon completed the install job without an outcome.' };
        return { ok: true, jobId, outcome: read.outcome };
      }
      if (!interrupted) await delay(1_000, undefined, { signal: controller.signal }).catch((error: unknown) => {
        if (!controller.signal.aborted) throw error;
      });
      // A cancel acknowledgement is not the terminal fact: read the owner again
      // so a racing successful completion is not relabeled as cancellation.
    }
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
