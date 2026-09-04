import {
  acquireHomeCarrierByPolicy,
  resolveHomeCarrierPreferredTransport,
  type HomeCarrierPreferredTransport,
} from '@happier-dev/cli-common/homeEnrollment';
import {
  classifyIrohHomeCarrierFailure,
} from '@happier-dev/iroh-native';
import {
  createNodeIrohHomeTunnelSession,
  type NodeIrohHomeTunnelSession,
} from '@happier-dev/iroh-native/node';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

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
  createSession(): Promise<NodeIrohHomeTunnelSession>;
  classifyFailure(error: unknown): Readonly<{ fallbackAllowed: boolean }>;
}>;

const DEFAULT_DEPS: TerminalAuthEnrollmentRuntimeDeps = {
  createSession: async () => await createNodeIrohHomeTunnelSession(),
  classifyFailure: classifyIrohHomeCarrierFailure,
};

export async function acquireTerminalAuthEnrollmentRuntime(
  descriptor: HomeConnectionDescriptorV1,
  preferredTransportOrDeps: HomeCarrierPreferredTransport | TerminalAuthEnrollmentRuntimeDeps = DEFAULT_DEPS,
): Promise<AcquiredTerminalAuthEnrollmentRuntime> {
  const preferredTransport = typeof preferredTransportOrDeps === 'string'
    ? preferredTransportOrDeps
    : resolveHomeCarrierPreferredTransport(descriptor);
  const deps = typeof preferredTransportOrDeps === 'string' ? DEFAULT_DEPS : preferredTransportOrDeps;
  let session: NodeIrohHomeTunnelSession | null = null;
  const shutdownCreatedSession = async (): Promise<void> => {
    const current = session;
    if (current) await current.shutdown();
  };
  const result = await acquireHomeCarrierByPolicy({
    descriptor,
    preferredTransport,
    acquireIroh: async ({ descriptor: requestedDescriptor }) => {
      if (!session) {
        const createdSession = await deps.createSession();
        session = createdSession;
      }
      const lease = await session.ensureHomeTunnel({ descriptor: requestedDescriptor });
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
