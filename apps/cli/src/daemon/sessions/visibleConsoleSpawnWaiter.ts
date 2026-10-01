import type { PersistedTakeoverAdmissionWaitRegistration } from '../spawn/persistedTakeoverAdmission';
import { isPidPresent } from '@happier-dev/cli-common/process';

import type { SpawnSessionResult } from '@/session/shared/spawnSessionContract';
import { SPAWN_SESSION_ERROR_CODES } from '@/session/shared/spawnSessionContract';
import type { ChildExit } from './onChildExited';
import type { TrackedSession } from '../types';
import { waitForSessionWebhook, type SessionWebhookCompletion } from '../spawn/waitForSessionWebhook';

export function waitForVisibleConsoleSessionWebhook(params: Readonly<{
  pid: number;
  pollMs: number;
  pidToAwaiter: Map<number, (session: TrackedSession) => void>;
  pidToSpawnResultResolver: Map<number, (result: SpawnSessionResult) => void>;
  pidToSpawnWebhookTimeout: Map<number, ReturnType<typeof setTimeout>>;
  takeoverAdmission?: PersistedTakeoverAdmissionWaitRegistration;
  pidToTrackedSession?: Map<number, TrackedSession>;
  onChildExited: (pid: number, exit: ChildExit) => void | Promise<void>;
  onSuccess?: (session: TrackedSession) => void | Promise<void>;
}>): SessionWebhookCompletion {
  const { pid, pollMs, pidToAwaiter, pidToSpawnResultResolver, pidToSpawnWebhookTimeout, onChildExited } = params;
  let interval: ReturnType<typeof setInterval> | undefined;
  const completion = waitForSessionWebhook({
    pid, pidToAwaiter, takeoverAdmission: params.takeoverAdmission,
    pidToSpawnResultResolver, pidToSpawnWebhookTimeout,
    pidToTrackedSession: params.pidToTrackedSession, onSuccess: params.onSuccess,
    timeoutErrorMessage: `Session webhook timeout for PID ${pid}`,
    onTimeout: () => { if (interval) clearInterval(interval); },
  });
  let exitObserved = false;
  interval = setInterval(() => {
    const currentPid = completion.getCurrentPid();
    // Only proof of absence retires the session. A pid we may not signal is still running, and
    // reporting `process-exited` for it would tear down a live console session.
    if (isPidPresent(currentPid)) return;
    if (exitObserved) return;
    exitObserved = true;
    const exitedBeforeWebhook = completion.isPending();
    void (async () => {
      try {
        await onChildExited(currentPid, {
          reason: exitedBeforeWebhook
            ? 'process-exited-before-webhook'
            : 'process-exited',
          code: null,
          signal: null,
        });
        if (completion.getCurrentPid() !== currentPid && isPidPresent(completion.getCurrentPid())) {
          exitObserved = false;
          return;
        }
      } catch {
        if (interval) clearInterval(interval);
        completion.settleFailure({
          type: 'error',
          errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_FAILED,
          errorMessage:
            'startup_retirement_incomplete:exit_cleanup_incomplete',
        });
        return;
      }
      if (interval) clearInterval(interval);
      completion.settleFailure({
        type: 'error',
        errorCode: SPAWN_SESSION_ERROR_CODES.CHILD_EXITED_BEFORE_WEBHOOK,
        errorMessage:
          `Child process exited before session webhook (pid=${currentPid})`,
      });
    })();
  }, pollMs);
  if (typeof interval.unref === 'function') {
    interval.unref();
  }

  return completion;
}
