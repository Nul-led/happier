/**
 * Thin CLI coordinator for Account Service Home entry.
 *
 * Authentication/session persistence and the shared deterministic Directory
 * journey are injected owners. This module owns only CLI sequencing and never
 * returns credentials or approval material in its public result.
 */

import { enrollmentPollingBackoffMs } from '@happier-dev/cli-common/homeEnrollment';

export type CliAccountServiceRequestedMethod =
  | Readonly<{ kind: 'key' }>
  | Readonly<{ kind: 'provider'; providerId: string }>;

export type CliAccountServiceSelection = Readonly<{
  endpoint: string;
  expectedServerIdentityId?: string;
}>;

export type CliAccountServiceTarget = Readonly<{
  endpoint: string;
  serverIdentityId: string;
}>;

export type CliAccountServiceRestrictedCredential = Readonly<{
  token: string;
}>;

export type CliAccountServiceHomeEntryOutcome =
  | Readonly<{
      kind: 'preferred_home_enrolled';
      homeServerIdentityId: string;
      profileId: string;
    }>
  | Readonly<{ kind: 'no_linked_homes' }>
  | Readonly<{ kind: 'no_preferred_home' }>
  | Readonly<{ kind: 'key_required' }>
  | Readonly<{ kind: 'update_required' }>
  | Readonly<{ kind: 'account_service_unavailable' }>
  | Readonly<{ kind: 'home_unavailable' }>
  | CliAccountServiceApprovalContinuation
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'timed_out' }>
  | Readonly<{ kind: 'identity_mismatch' }>
  | Readonly<{ kind: 'destination_mismatch' }>
  | Readonly<{ kind: 'failed' }>;

export type CliAccountServiceAuthenticationOutcome =
  | Readonly<{
      kind: 'authenticated';
      target: CliAccountServiceTarget;
      credential: CliAccountServiceRestrictedCredential;
    }>
  | Exclude<CliAccountServiceHomeEntryOutcome, { kind: 'preferred_home_enrolled' | 'no_linked_homes' | 'no_preferred_home' | 'home_unavailable' | 'awaiting_approval' }>;

export type CliAccountServiceDirectoryJourneyOutcome =
  | Extract<CliAccountServiceHomeEntryOutcome, {
      kind:
        | 'preferred_home_enrolled'
        | 'no_linked_homes'
        | 'no_preferred_home'
        | 'update_required'
        | 'account_service_unavailable'
        | 'home_unavailable'
        | 'awaiting_approval'
        | 'cancelled'
        | 'timed_out'
        | 'identity_mismatch'
        | 'destination_mismatch'
        | 'failed';
    }>;

export type CliAccountServiceApprovalContinuation = Readonly<{
  kind: 'awaiting_approval';
  homeServerIdentityId: string;
  expiresAtMs: number;
  resume(input: Readonly<{ signal: AbortSignal }>): Promise<CliAccountServiceDirectoryAttemptOutcome>;
}>;

export type CliAccountServiceDirectoryAttemptOutcome =
  | Exclude<CliAccountServiceDirectoryJourneyOutcome, { kind: 'awaiting_approval' }>
  | CliAccountServiceApprovalContinuation;

export type CliAccountServiceHomeEntryPorts = Readonly<{
  authenticateExactMethod(input: Readonly<{
    service: CliAccountServiceSelection;
    method: CliAccountServiceRequestedMethod;
    key?: Uint8Array;
    signal?: AbortSignal;
    timeoutMs?: number;
  }>): Promise<CliAccountServiceAuthenticationOutcome>;
  runDirectoryJourney(input: Readonly<{
    target: CliAccountServiceTarget;
    credential: CliAccountServiceRestrictedCredential;
    signal?: AbortSignal;
    timeoutMs?: number;
  }>): Promise<CliAccountServiceDirectoryAttemptOutcome>;
  openPreferredHome(input: Readonly<{
    homeServerIdentityId: string;
    profileId: string;
  }>): Promise<
    | Readonly<{ kind: 'opened' }>
    | Extract<CliAccountServiceHomeEntryOutcome, {
        kind: 'home_unavailable' | 'cancelled' | 'timed_out' | 'identity_mismatch' | 'failed';
      }>
  >;
  continueMachineAndService(input: Readonly<{
    homeServerIdentityId: string;
    profileId: string;
  }>): Promise<
    | Readonly<{ kind: 'continued' }>
    | Extract<CliAccountServiceHomeEntryOutcome, {
        kind: 'home_unavailable' | 'cancelled' | 'timed_out' | 'identity_mismatch' | 'failed';
      }>
  >;
}>;

type CliAccountServiceHomeEntryInputBase = Readonly<{
  service: CliAccountServiceSelection;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type CliAccountServiceHomeEntryInput = CliAccountServiceHomeEntryInputBase & (
  | Readonly<{
      existingAuthentication: Extract<CliAccountServiceAuthenticationOutcome, { kind: 'authenticated' }>;
      method?: never;
      key?: never;
    }>
  | Readonly<{
      existingAuthentication?: never;
      method: CliAccountServiceRequestedMethod;
      key?: Uint8Array;
    }>
);

export type CliAccountServiceHomeEntryCoordinator = Readonly<{
  run(input: CliAccountServiceHomeEntryInput): Promise<CliAccountServiceHomeEntryOutcome>;
  cancel(): boolean;
}>;

async function waitForApprovalPoll(signal: AbortSignal, delayMs: number): Promise<boolean> {
  if (signal.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function runCliAccountServiceHomeEntryWithSignal(
  input: CliAccountServiceHomeEntryInput,
  ports: CliAccountServiceHomeEntryPorts,
): Promise<CliAccountServiceHomeEntryOutcome> {
  const signal = input.signal ?? new AbortController().signal;
  const entryDeadlineMs = input.timeoutMs === undefined
    ? Number.POSITIVE_INFINITY
    : Date.now() + input.timeoutMs;
  if (signal.aborted) return { kind: 'cancelled' };
  if (!input.existingAuthentication && input.method.kind === 'key' && input.key === undefined) {
    return { kind: 'key_required' };
  }

  const authentication = input.existingAuthentication ?? await ports.authenticateExactMethod({
    service: input.service,
    method: input.method,
    ...(input.key ? { key: input.key } : {}),
    signal,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  if (authentication.kind !== 'authenticated') return authentication;
  if (signal.aborted) return { kind: 'cancelled' };

  let journey = await ports.runDirectoryJourney({
    target: authentication.target,
    credential: authentication.credential,
    signal,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });
  let approvalPollCount = 1;
  while (journey.kind === 'awaiting_approval') {
    if (signal.aborted) return { kind: 'cancelled' };
    const nowMs = Date.now();
    const deadlineMs = Math.min(
      journey.expiresAtMs,
      entryDeadlineMs,
    );
    if (deadlineMs <= nowMs) return { kind: 'timed_out' };
    const elapsed = await waitForApprovalPoll(
      signal,
      Math.min(enrollmentPollingBackoffMs(approvalPollCount), deadlineMs - nowMs),
    );
    if (!elapsed) return { kind: 'cancelled' };
    if (Date.now() >= deadlineMs) return { kind: 'timed_out' };
    journey = await journey.resume({ signal });
    approvalPollCount += 1;
  }
  if (journey.kind !== 'preferred_home_enrolled') return journey;
  if (signal.aborted) return { kind: 'cancelled' };

  const home = {
    homeServerIdentityId: journey.homeServerIdentityId,
    profileId: journey.profileId,
  };
  const opened = await ports.openPreferredHome(home);
  if (opened.kind !== 'opened') return opened;
  if (signal.aborted) return { kind: 'cancelled' };

  const continued = await ports.continueMachineAndService(home);
  if (continued.kind !== 'continued') return continued;

  return journey;
}

export async function runCliAccountServiceHomeEntry(
  input: CliAccountServiceHomeEntryInput,
  ports: CliAccountServiceHomeEntryPorts,
): Promise<CliAccountServiceHomeEntryOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (input.signal?.aborted) controller.abort();
  const timer = input.timeoutMs === undefined
    ? null
    : setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, input.timeoutMs);
  try {
    const result = await runCliAccountServiceHomeEntryWithSignal({
      ...input,
      signal: controller.signal,
    }, ports);
    // Opening the Home and continuing machine/service setup are deliberately
    // non-cancellable. Once both report success, that completed terminal fact
    // must win over a timeout or caller abort that raced during continuation.
    if (result.kind !== 'preferred_home_enrolled') {
      if (timedOut) return { kind: 'timed_out' };
      if (input.signal?.aborted) return { kind: 'cancelled' };
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    input.signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Process-local CLI entry owner consumed by U10-06. It owns replacement and
 * cancellation of the current CLI journey while the injected ports retain
 * authentication, Directory, Home, focus, and service authority.
 */
export function createCliAccountServiceHomeEntryCoordinator(
  ports: CliAccountServiceHomeEntryPorts,
): CliAccountServiceHomeEntryCoordinator {
  let activeController: AbortController | null = null;

  return {
    async run(input) {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const abortFromCaller = () => controller.abort();
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
      if (input.signal?.aborted) controller.abort();
      try {
        return await runCliAccountServiceHomeEntry({
          ...input,
          signal: controller.signal,
        }, ports);
      } finally {
        input.signal?.removeEventListener('abort', abortFromCaller);
        if (activeController === controller) activeController = null;
      }
    },

    cancel() {
      const controller = activeController;
      if (!controller) return false;
      controller.abort();
      return true;
    },
  };
}
