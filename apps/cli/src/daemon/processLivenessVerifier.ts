import {
  readProcessRunState,
  type ProcessRunState,
} from './processRunState';
import { isPidSafeHappySessionProcess } from './pidSafety';
import { processGenerationProvesReuse, readProcessIdentityByPid } from './processIdentity';
import type { DaemonSessionMarker } from './sessionRegistry';

/** Only a fresh, different process-start witness may report proven_reused. */
export type ProcessIdentityVerification = 'verified' | 'proven_reused' | 'unknown';

export type VerifiedProcessLiveness = Readonly<{
  status: 'verified_running' | 'verified_stopped' | 'unknown';
  pid: number;
  processStartTimeMs?: number;
}>;

type ReadProcessRunState = (pid: number) => Promise<ProcessRunState>;

export async function verifyProcessLiveness(params: Readonly<{
  pid: number;
  processStartTimeMs?: number;
  verifyIdentity: (pid: number) => Promise<ProcessIdentityVerification>;
  readRunState?: ReadProcessRunState;
}>): Promise<VerifiedProcessLiveness> {
  const processStartTimeMs = params.processStartTimeMs;
  const processIdentity = {
    pid: params.pid,
    ...(processStartTimeMs === undefined ? {} : { processStartTimeMs }),
  };
  if (
    !Number.isInteger(params.pid)
    || params.pid <= 0
    || !Number.isInteger(processStartTimeMs)
    || (processStartTimeMs ?? -1) < 0
  ) {
    return { status: 'unknown', ...processIdentity };
  }

  const readRunState = params.readRunState ?? readProcessRunState;
  let runState: ProcessRunState;
  try {
    runState = await readRunState(params.pid);
  } catch {
    return { status: 'unknown', ...processIdentity };
  }

  if (runState === 'dead' || runState === 'zombie') {
    return { status: 'verified_stopped', ...processIdentity };
  }
  if (runState !== 'servable') {
    return { status: 'unknown', ...processIdentity };
  }

  try {
    const verification = await params.verifyIdentity(params.pid);
    return {
      status: verification === 'verified'
        ? 'verified_running'
        : verification === 'proven_reused'
          ? 'verified_stopped'
          : 'unknown',
      ...processIdentity,
    };
  } catch {
    return { status: 'unknown', ...processIdentity };
  }
}

type VerifyHappyProcessIdentity = typeof isPidSafeHappySessionProcess;

export async function verifySessionMarkerProcessLiveness(
  marker: Pick<DaemonSessionMarker, 'pid' | 'processCommandHash' | 'processStartTimeMs'>,
  deps: Readonly<{
    readRunState?: ReadProcessRunState;
    verifyHappyProcessIdentity?: VerifyHappyProcessIdentity;
    readProcessIdentityByPidFn?: typeof readProcessIdentityByPid;
  }> = {},
): Promise<VerifiedProcessLiveness> {
  const processCommandHash = marker.processCommandHash;
  const processStartTimeMs = marker.processStartTimeMs;
  return await verifyProcessLiveness({
    pid: marker.pid,
    processStartTimeMs,
    readRunState: deps.readRunState,
    verifyIdentity: async (pid) => {
      if (!processCommandHash && processStartTimeMs === undefined) return 'unknown';
      const verifyHappyProcessIdentity =
        deps.verifyHappyProcessIdentity ?? isPidSafeHappySessionProcess;
      if (await verifyHappyProcessIdentity({
        pid,
        expectedProcessCommandHash: processCommandHash,
        expectedProcessStartTimeMs: processStartTimeMs,
      })) return 'verified';
      const observed = await (deps.readProcessIdentityByPidFn ?? readProcessIdentityByPid)(pid).catch(() => null);
      return observed?.pid === pid
        && processGenerationProvesReuse(processStartTimeMs, observed.processStartTimeMs)
        ? 'proven_reused'
        : 'unknown';
    },
  });
}
