import {
  deriveHomeQrRendezvousVerifierV2,
  encodeBase64,
  readServerEnabledBit,
  type FeaturesResponse,
  type HomeConnectionDescriptorV1,
  type HomeQrInviteV2,
} from '@happier-dev/protocol';

import { ENROLLMENT_POLL_IDLE_DELAY_MS, enrollmentPollingBackoffMs } from './enrollmentPollingBackoff.js';

const DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS = 5_000;

export type DirectHomeQrPairingStatus =
  | Readonly<{ state: 'pending'; pairId: string; expiresAt: string }>
  | Readonly<{
      state: 'requested';
      pairId: string;
      expiresAt: string;
      requestedPublicKey: string;
      requestedDeviceLabel: string | null;
      bindingProof: string;
      homeServerIdentityId: string;
    }>;

export class DirectHomeQrCompletionError extends Error {
  constructor(readonly classification: 'invalid' | 'retryable' | 'failed') {
    super(`Direct Home QR completion ${classification}`);
    this.name = 'DirectHomeQrCompletionError';
  }
}

export type DirectHomeQrLifecycleAdapters = Readonly<{
  randomBytes(length: number): Uint8Array | Promise<Uint8Array>;
  now(): number;
  start(input: Readonly<{ direction: 'trusted_home_displays'; secretHash: string }>): Promise<
    | Readonly<{ ok: true; pairId: string; expiresAt: string }>
    | Readonly<{ ok: false; status: number }>
  >;
  poll(input: Readonly<{ pairId: string; signal: AbortSignal; timeoutMs: number }>): Promise<
    | Readonly<{ ok: true; status: DirectHomeQrPairingStatus }>
    | Readonly<{ ok: false; reason: 'not_found' | 'invalid' | 'transient'; status: number }>
  >;
  consume(input: Readonly<{ pairId: string; intent: 'cancel' | 'reject'; signal: AbortSignal; timeoutMs: number }>): Promise<Readonly<{ ok: boolean }>>;
  complete(input: Readonly<{
    context: Readonly<{
      direction: 'trusted_home_displays';
      pairId: string;
      descriptor: HomeConnectionDescriptorV1;
      qrSecret: Uint8Array;
      issuedAtMs: number;
      expiresAtMs: number;
    }>;
    status: Extract<DirectHomeQrPairingStatus, { state: 'requested' }>;
    signal: AbortSignal;
  }>): Promise<'completed' | 'already_completed'>;
  buildRenderableInvite(invite: HomeQrInviteV2):
    | Readonly<{ ok: true; link: string; invite: HomeQrInviteV2 }>
    | Readonly<{ ok: false; reason: 'qr_unavailable'; link: string }>
    | Readonly<{ ok: false; reason: 'invalid_invite' }>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}>;

export type DirectHomeQrCompletionOutcome =
  | Readonly<{ kind: 'completed'; requestedDeviceLabel: string | null }>
  | Readonly<{ kind: 'cancelled' | 'expired' | 'invalid_request' }>
  | Readonly<{ kind: 'failed'; status: number }>;

export type DirectHomeQrStartResult =
  | Readonly<{ kind: 'update_required' }>
  | Readonly<{ kind: 'failed'; status: number; reason: 'invalid_invite' | 'start_failed' }>
  | Readonly<{
      kind: 'started';
      invite: HomeQrInviteV2;
      link: string;
      qrAvailable: boolean;
      completion: Promise<DirectHomeQrCompletionOutcome>;
      cancel(): Promise<Readonly<{ ok: boolean }>>;
    }>;

export function admitDirectHomeQrV2(features: FeaturesResponse): Readonly<{ kind: 'admitted' | 'update_required' }> {
  return readServerEnabledBit(features, 'auth.pairing.boundQrV2') === true
    ? { kind: 'admitted' }
    : { kind: 'update_required' };
}

export async function startDirectHomeQrLifecycle(input: Readonly<{
  features: FeaturesResponse;
  descriptor: HomeConnectionDescriptorV1;
  adapters: DirectHomeQrLifecycleAdapters;
  signal?: AbortSignal;
}>): Promise<DirectHomeQrStartResult> {
  if (admitDirectHomeQrV2(input.features).kind !== 'admitted') {
    await input.adapters.close().catch(() => undefined);
    return { kind: 'update_required' };
  }

  let qrSecret: Uint8Array;
  try {
    qrSecret = await input.adapters.randomBytes(32);
  } catch {
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: 500, reason: 'start_failed' };
  }
  if (qrSecret.byteLength !== 32) {
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: 500, reason: 'start_failed' };
  }
  const secretHash = encodeBase64(deriveHomeQrRendezvousVerifierV2(qrSecret), 'base64url');
  let started: Awaited<ReturnType<DirectHomeQrLifecycleAdapters['start']>>;
  try {
    started = await input.adapters.start({ direction: 'trusted_home_displays', secretHash });
  } catch {
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: 0, reason: 'start_failed' };
  }
  if (!started.ok) {
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: started.status, reason: 'start_failed' };
  }
  const issuedAtMs = input.adapters.now();
  const expiresAtMs = Date.parse(started.expiresAt);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= issuedAtMs) {
    const timeoutMs = Math.min(DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS, Math.max(1, expiresAtMs - input.adapters.now()));
    await input.adapters.consume({ pairId: started.pairId, intent: 'cancel', signal: AbortSignal.timeout(timeoutMs), timeoutMs }).catch(() => ({ ok: false }));
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: 502, reason: 'start_failed' };
  }

  const invite: HomeQrInviteV2 = {
    v: 2,
    intent: 'home_device',
    direction: 'trusted_home_displays',
    pairId: started.pairId,
    home: input.descriptor,
    qrSecretBase64Url: encodeBase64(qrSecret, 'base64url'),
    issuedAtMs,
    expiresAtMs,
  };
  const rendered = input.adapters.buildRenderableInvite(invite);
  if (!rendered.ok && rendered.reason === 'invalid_invite') {
    const timeoutMs = Math.min(DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS, Math.max(1, expiresAtMs - input.adapters.now()));
    await input.adapters.consume({ pairId: started.pairId, intent: 'cancel', signal: AbortSignal.timeout(timeoutMs), timeoutMs }).catch(() => ({ ok: false }));
    await input.adapters.close().catch(() => undefined);
    return { kind: 'failed', status: 422, reason: 'invalid_invite' };
  }

  const controller = new AbortController();
  let cancelled = false;
  let cancelStarted: Promise<Readonly<{ ok: boolean }>> | null = null;
  const cancel = (): Promise<Readonly<{ ok: boolean }>> => {
    cancelStarted ??= (async () => {
      cancelled = true;
      controller.abort();
      const timeoutMs = Math.min(DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS, Math.max(1, expiresAtMs - input.adapters.now()));
      return await input.adapters.consume({ pairId: started.pairId, intent: 'cancel', signal: AbortSignal.timeout(timeoutMs), timeoutMs }).catch(() => ({ ok: false }));
    })();
    return cancelStarted;
  };
  const onExternalAbort = () => { void cancel(); };
  if (input.signal?.aborted) await cancel();
  else input.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const completion = (async (): Promise<DirectHomeQrCompletionOutcome> => {
    let transientFailures = 0;
    try {
      while (!cancelled) {
        if (input.adapters.now() >= expiresAtMs) return { kind: 'expired' };
        let result: Awaited<ReturnType<DirectHomeQrLifecycleAdapters['poll']>>;
        try {
          result = await input.adapters.poll({
            pairId: started.pairId,
            signal: controller.signal,
            timeoutMs: Math.max(1, expiresAtMs - input.adapters.now()),
          });
        } catch {
          result = { ok: false, reason: 'transient', status: 0 };
        }
        if (cancelled) return { kind: 'cancelled' };
        if (!result.ok) {
          if (result.reason === 'not_found') return { kind: 'expired' };
          if (result.reason !== 'transient') {
            const timeoutMs = Math.min(DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS, Math.max(1, expiresAtMs - input.adapters.now()));
            await input.adapters.consume({ pairId: started.pairId, intent: 'reject', signal: AbortSignal.timeout(timeoutMs), timeoutMs }).catch(() => ({ ok: false }));
            return { kind: 'invalid_request' };
          }
          transientFailures += 1;
        } else if (result.status.state === 'requested') {
          try {
            await input.adapters.complete({
              context: {
                direction: 'trusted_home_displays',
                pairId: started.pairId,
                descriptor: input.descriptor,
                qrSecret,
                issuedAtMs,
                expiresAtMs,
              },
              status: result.status,
              signal: controller.signal,
            });
            return cancelled
              ? { kind: 'cancelled' }
              : { kind: 'completed', requestedDeviceLabel: result.status.requestedDeviceLabel };
          } catch (error) {
            if (cancelled) return { kind: 'cancelled' };
            if (error instanceof DirectHomeQrCompletionError && error.classification === 'retryable') {
              transientFailures += 1;
            } else if (error instanceof DirectHomeQrCompletionError && error.classification === 'invalid') {
              const timeoutMs = Math.min(DIRECT_HOME_QR_CLEANUP_TIMEOUT_MS, Math.max(1, expiresAtMs - input.adapters.now()));
              await input.adapters.consume({ pairId: started.pairId, intent: 'reject', signal: AbortSignal.timeout(timeoutMs), timeoutMs }).catch(() => ({ ok: false }));
              return { kind: 'invalid_request' };
            } else {
              return { kind: 'failed', status: 500 };
            }
          }
        } else {
          transientFailures = 0;
        }
        const remainingMs = expiresAtMs - input.adapters.now();
        if (remainingMs <= 0) return { kind: 'expired' };
        const delayMs = Math.min(
          transientFailures === 0 ? ENROLLMENT_POLL_IDLE_DELAY_MS : enrollmentPollingBackoffMs(transientFailures),
          remainingMs,
        );
        try {
          await input.adapters.sleep(delayMs, controller.signal);
        } catch {
          if (cancelled || controller.signal.aborted) return { kind: 'cancelled' };
        }
      }
      return { kind: 'cancelled' };
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort);
      await input.adapters.close().catch(() => undefined);
    }
  })();

  return {
    kind: 'started',
    invite,
    link: rendered.link,
    qrAvailable: rendered.ok,
    completion,
    cancel,
  };
}
