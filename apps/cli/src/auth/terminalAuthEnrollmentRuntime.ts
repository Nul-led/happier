import {
  acquireHomeCarrierByPolicy,
  resolveHomeCarrierPreferredTransport,
  type HomeCarrierPreferredTransport,
} from '@happier-dev/cli-common/homeEnrollment';
import {
  classifyIrohHomeCarrierFailure,
  createNodeIrohHomeTunnelSession,
  type NodeIrohHomeTunnelSession,
} from '@happier-dev/iroh-native/node';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/agents';

import { resolveCliIrohEndpointKeyPath } from '@/daemon/peer/iroh/irohEndpointIdentity';
import type { TerminalAuthEnrollmentRuntime } from './terminalAuthEnrollmentClient';

export type AcquiredTerminalAuthEnrollmentRuntime =
  | Readonly<{
      ok: true;
      runtime: TerminalAuthEnrollmentRuntime;
      close(): Promise<void>;
    }>
  | Readonly<{
      ok: false;
      reason: 'unavailable' | 'fail_closed';
      error: unknown;
    }>;

type TerminalAuthEnrollmentRuntimeDeps = Readonly<{
  createSession(input: Readonly<{ endpointKeyPath: string }>): Promise<NodeIrohHomeTunnelSession>;
  classifyFailure(error: unknown): Readonly<{ fallbackAllowed: boolean }>;
}>;

export type TerminalAuthEnrollmentRuntimeOptions = Readonly<{
  /** Request-scoped CLI home that owns the one canonical Iroh endpoint key. */
  happyHomeDir?: string;
}>;

const DEFAULT_DEPS: TerminalAuthEnrollmentRuntimeDeps = {
  createSession: async ({ endpointKeyPath }) => await createNodeIrohHomeTunnelSession({ endpointKeyPath }),
  classifyFailure: classifyIrohHomeCarrierFailure,
};

export async function acquireTerminalAuthEnrollmentRuntime(
  descriptor: HomeConnectionDescriptorV1,
  preferredTransportOrDeps: HomeCarrierPreferredTransport | TerminalAuthEnrollmentRuntimeDeps = DEFAULT_DEPS,
  signal?: AbortSignal,
  options: TerminalAuthEnrollmentRuntimeOptions = {},
): Promise<AcquiredTerminalAuthEnrollmentRuntime> {
  const preferredTransport = typeof preferredTransportOrDeps === 'string'
    ? preferredTransportOrDeps
    : resolveHomeCarrierPreferredTransport(descriptor);
  const deps = typeof preferredTransportOrDeps === 'string' ? DEFAULT_DEPS : preferredTransportOrDeps;
  const endpointKeyPath = resolveCliIrohEndpointKeyPath(
    options.happyHomeDir ?? resolveHappyHomeDirFromEnvironment(process.env),
  );
  let session: NodeIrohHomeTunnelSession | null = null;
  const shutdownCreatedSession = async (): Promise<void> => {
    const current = session;
    if (current) await current.shutdown();
  };
  const result = await acquireHomeCarrierByPolicy({
    mode: 'initial_selection',
    applicationCarrierEligibility: 'automatic',
    descriptor,
    preferredTransport,
    acquireIroh: async ({ descriptor: requestedDescriptor }) => {
      if (!session) {
        const createdSession = await deps.createSession({ endpointKeyPath });
        session = createdSession;
      }
      const lease = await session.ensureHomeTunnel({
        descriptor: requestedDescriptor,
        ...(signal ? { signal } : {}),
      });
      return { ...lease, value: lease.runtimeOrigin };
    },
    classifyFailure: deps.classifyFailure,
  });

  if (result.kind === 'unavailable' || result.kind === 'fail_closed') {
    await shutdownCreatedSession().catch(() => undefined);
    return { ok: false, reason: result.kind, error: result.error };
  }

  if (result.kind === 'https') {
    return {
      ok: true,
      runtime: {
        runtimeOrigin: result.runtimeOrigin,
        carrier: 'https',
        authenticatedCredentialDestination: {
          kind: 'https',
          applicationUrl: result.runtimeOrigin,
        },
      },
      close: shutdownCreatedSession,
    };
  }

  return {
    ok: true,
    runtime: {
      runtimeOrigin: result.carrier.value,
      carrier: 'iroh',
      authenticatedCredentialDestination: {
        kind: 'iroh',
        endpointId: result.carrier.endpointId,
      },
    },
    close: async () => {
      const outcomes = await Promise.allSettled([
        result.release(),
        shutdownCreatedSession(),
      ]);
      const failures = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason] : [],
      );
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, 'Failed to release the Home tunnel and shut down its native session.');
      }
    },
  };
}
