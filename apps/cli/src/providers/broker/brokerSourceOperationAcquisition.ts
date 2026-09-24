import type {
  ManagedProviderExplicitStartCustody,
  ManagedProviderExplicitStartCustodyRequest,
} from '@/providers/connections/publicManagedRuntimeStart';

type AcquiredBrokerSourceOperation = Readonly<{
  projection: NonNullable<Awaited<ReturnType<ManagedProviderExplicitStartCustody['acquire']>>>;
  /** The last decided answer, without re-reading anything. */
  isAuthorizationCurrent(): boolean;
  /** Re-decide this operation's own authority; false means it has ended. */
  revalidateAuthorization(): Promise<boolean>;
  /** End the operation's custody claim. Idempotent and never double-retires. */
  retire(): Promise<void>;
}>;

/**
 * Acquire the managed Provider operation behind one broker source.
 *
 * Both broker source adapters — the Connected Account/Pool projection and the
 * Provider Connection CPX bridge — need exactly this: a managed explicit-start
 * claim keyed by the operation, a retained currentness answer, and a retirement
 * that runs once. They wrote it twice and had already drifted (one memoized
 * retirement, the other did not), so the decision lives here and each adapter
 * supplies only its own source-currentness function.
 *
 * The distinction this owner exists to keep straight: the **operation's**
 * retained currentness is its own authority — the resource, the source and the
 * Session/Run the claim belongs to — while `callerSignal` is one caller's
 * stream. A signed operation is shared by every stream opened against it, so
 * the caller's cancellation must not become the operation's currentness:
 * closing the first stream would otherwise leave the retained operation
 * permanently non-current and every later stream would be refused against a
 * process that is still held. Custody already bounds the per-caller join with
 * this signal, so it is passed for that and nothing else.
 */
export async function acquireBrokerSourceOperation(input: Readonly<{
  custody: ManagedProviderExplicitStartCustody;
  identity: ManagedProviderExplicitStartCustodyRequest['identity'];
  contributionKey: string;
  endpointTemplateId: string;
  operationClaim: ManagedProviderExplicitStartCustodyRequest['operationClaim'];
  purposeBindings: ManagedProviderExplicitStartCustodyRequest['purposeBindings'];
  /** This operation's own authority: resource, source and consumer liveness. */
  isSourceCurrent(signal?: AbortSignal): Promise<boolean>;
  /** Present only where the retained claim can be revalidated in the background. */
  revalidateOperationAuthorization?: (signal?: AbortSignal) => Promise<boolean>;
  callerSignal: AbortSignal;
}>): Promise<AcquiredBrokerSourceOperation | null> {
  let authorizationCurrent = true;
  const isAuthorizationCurrent = (): boolean => authorizationCurrent;
  const revalidateAuthorization = async (): Promise<boolean> => {
    authorizationCurrent = authorizationCurrent
      && await input.isSourceCurrent().catch(() => false);
    return authorizationCurrent;
  };
  let retired = false;
  let retireInFlight: Promise<void> | null = null;
  const retire = (): Promise<void> => {
    if (retired) return Promise.resolve();
    retireInFlight ??= input.custody.retire({
      identity: input.identity,
      operationClaim: input.operationClaim,
    }).then(
      () => {
        retired = true;
        retireInFlight = null;
      },
      (error: unknown) => {
        retireInFlight = null;
        throw error;
      },
    );
    return retireInFlight;
  };
  const revalidateOperationAuthorization = input.revalidateOperationAuthorization;
  const projection = await input.custody.acquire({
    contributionKey: input.contributionKey,
    identity: input.identity,
    request: {
      reason: 'explicitStartLocal',
      endpointTemplateIds: [input.endpointTemplateId],
    },
    purposeBindings: input.purposeBindings,
    isAuthorizationCurrent,
    revalidateAuthorization,
    ...(revalidateOperationAuthorization
      ? {
          revalidateRetainedCurrentness: async (signal?: AbortSignal) => (
            await input.isSourceCurrent(signal).catch(() => false)
            && await revalidateOperationAuthorization(signal)
          ),
        }
      : {}),
    operationClaim: input.operationClaim,
    signal: input.callerSignal,
  });
  if (!projection || !await revalidateAuthorization()) {
    if (projection) {
      await retire().catch(() => undefined);
      await Promise.resolve(projection.cleanup()).catch(() => undefined);
    }
    return null;
  }
  return Object.freeze({ projection, isAuthorizationCurrent, revalidateAuthorization, retire });
}
