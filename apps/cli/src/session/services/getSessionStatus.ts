import type { SessionAwarenessProjectionV1 } from '@happier-dev/protocol';
import { projectCliSessionAwarenessV1 } from '@/cli/output/session/sessionAwareness';
import type { StoredCredentials } from '@/persistence';
import { summarizeSessionRecord, type SessionSummary } from '@/cli/output/session/sessionSummary';
import { decryptSessionPayload } from '@/session/transport/encryption/sessionEncryptionContext';
import {
  readLatestAgentStateSummaryViaSocket,
  summarizeAgentState,
  type AgentStateSummary,
} from '@/session/transport/socket/sessionSocketAgentState';

import { resolveSessionTransportContext } from './resolveSessionTransportContext';
import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';

export type GetSessionStatusResult =
  | Readonly<{ ok: true; session: SessionSummary; agentState: AgentStateSummary | null; awareness: SessionAwarenessProjectionV1 }>
  | Readonly<{ ok: false; code: 'session_not_found' | 'session_id_ambiguous' | 'session_lookup_timeout' | 'unsupported' | 'encryption_material_unavailable'; candidates?: string[] }>;

function readSessionAgentState(params: Readonly<{
  sessionTarget: Extract<Awaited<ReturnType<typeof resolveSessionTransportContext>>, { ok: true }>;
}>): unknown | null {
  const agentStateCiphertext =
    typeof params.sessionTarget.rawSession.agentState === 'string'
      ? String(params.sessionTarget.rawSession.agentState).trim()
      : '';
  if (!agentStateCiphertext) {
    return null;
  }

  try {
    const decrypted =
      params.sessionTarget.mode === 'plain'
        ? JSON.parse(agentStateCiphertext)
        : decryptSessionPayload({
            ctx: params.sessionTarget.ctx,
            ciphertextBase64: agentStateCiphertext,
          });
    return decrypted;
  } catch {
    return null;
  }
}

function resolveLiveStatusWaitMs(): number {
  const liveWaitRaw = String(process.env.HAPPIER_SESSION_STATUS_LIVE_WAIT_MS ?? '').trim();
  const liveWaitParsed = liveWaitRaw ? Number.parseInt(liveWaitRaw, 10) : NaN;
  return Number.isFinite(liveWaitParsed) && liveWaitParsed > 0 ? Math.min(30_000, liveWaitParsed) : 3_000;
}

export async function getSessionStatus(params: Readonly<{
  credentials: StoredCredentials;
  idOrPrefix: string;
  live: boolean;
  serverFeaturesSnapshot?: CliServerFeaturesSnapshot;
}>): Promise<GetSessionStatusResult> {
  const sessionTarget = await resolveSessionTransportContext({
    credentials: params.credentials,
    idOrPrefix: params.idOrPrefix,
    ...(params.serverFeaturesSnapshot ? { serverFeaturesSnapshot: params.serverFeaturesSnapshot } : {}),
  });
  if (!sessionTarget.ok) {
    return {
      ok: false,
      code: sessionTarget.code,
      ...(sessionTarget.candidates ? { candidates: sessionTarget.candidates } : {}),
    };
  }

  const snapshotAgentState = readSessionAgentState({ sessionTarget });
  // Explicit: the socket callback below supplies a still-unvalidated `unknown` value, and the
  // awareness normalizer is the owner that parses it. Inferring this from the snapshot branch
  // would narrow `value` to the decoded snapshot's shape and reject the live evidence.
  let agentStateEvidence: Readonly<{ value: unknown; observedAtMs: number }> | undefined =
    snapshotAgentState === null ? undefined : {
      value: snapshotAgentState,
      observedAtMs: sessionTarget.rawSession.pendingRequestObservedAt ?? sessionTarget.rawSession.updatedAt,
    };
  let agentStateSummary = snapshotAgentState === null ? null : summarizeAgentState(snapshotAgentState);

  if (params.live) {
    try {
      const liveSummary = await readLatestAgentStateSummaryViaSocket({
        token: params.credentials.token,
        sessionId: sessionTarget.sessionId,
        ctx: sessionTarget.ctx,
        sessionEncryptionMode: sessionTarget.mode,
        timeoutMs: resolveLiveStatusWaitMs(),
        onAgentStateObserved: (value, observedAtMs) => {
          agentStateEvidence = { value, observedAtMs };
        },
      });
      if (liveSummary) {
        agentStateSummary = liveSummary;
      }
    } catch {
      // Best-effort only; fall back to snapshot state.
    }
  }

  return {
    ok: true,
    session: summarizeSessionRecord({
      credentials: params.credentials,
      accountEncryptionMode: sessionTarget.accountEncryptionCurrentness.mode,
      session: sessionTarget.rawSession,
    }),
    agentState: agentStateSummary,
    awareness: projectCliSessionAwarenessV1({
      credentials: params.credentials,
      accountEncryption: sessionTarget.accountEncryptionCurrentness,
      row: sessionTarget.rawSession,
      nowMs: Date.now(),
      ...(agentStateEvidence ? { agentState: agentStateEvidence } : {}),
    }),
  };
}
