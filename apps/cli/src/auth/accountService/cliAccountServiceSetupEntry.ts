import tweetnacl from 'tweetnacl';
import {
  ACCOUNT_DIRECTORY_HOMES_HTTP_PATH_V1,
  AccountDirectoryCapabilitiesSchema,
  AccountDirectoryHomesResponseV1Schema,
  HomeLoginAssertionResponseV1Schema,
  HomeLoginCredentialPayloadV1Schema,
  HomeLoginRedemptionResultV1Schema,
  HOME_LOGIN_HTTP_PATH_V1,
  buildAccountDirectoryHomeLoginAssertionHttpPathV1,
  decodeBase64,
  encodeBase64,
  normalizeServerIdentityIdCapability,
} from '@happier-dev/protocol';
import {
  observeAccountServiceHomeApproval,
  runAccountServiceDirectoryJourney,
  selectAccountServiceAuthenticationMethod,
  type AccountServiceHomeApproval,
  type AccountServiceHomeEnrollmentAdapters,
  type AccountServiceHomeEnrollmentResult,
} from '@happier-dev/cli-common/accountService';
import { resolveHappyHomeDirFromEnvironment } from '@happier-dev/cli-common/agents';

import { libsodiumDecryptForSecretKey } from '@/api/encryption';
import { registerMachineWithAuthenticatedHomeRuntime } from '@/ui/auth';
import { promptInput, promptSecretInput } from '@/terminal/prompts/promptInput';
import { promptMultipleChoice } from '@/terminal/prompts/promptMultipleChoice';
import { fetchServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { acquireTerminalAuthEnrollmentRuntime } from '@/auth/terminalAuthEnrollmentRuntime';
import {
  adoptServerProfileHomeConnectionDescriptor,
  useServerProfile,
} from '@/server/serverProfiles';
import { writeCredentialsTokenOnlyForServerId } from '@/persistence';
import { runWithServerProfileSelection } from '@/server/serverSelection';
import { createCliAccountServiceSessionOwner, type CliAccountServiceSelection } from './cliAccountServiceSession';
import {
  runCliAccountServiceHomeEntry,
  type CliAccountServiceAuthenticationOutcome,
  type CliAccountServiceDirectoryAttemptOutcome,
  type CliAccountServiceHomeEntryOutcome,
  type CliAccountServiceRequestedMethod,
} from './cliAccountServiceHomeEntry';
import { authenticateCliAccountService } from './cliAccountServiceAuth';

type CliHomeEnrollmentTransport = Extract<
  Awaited<ReturnType<typeof acquireTerminalAuthEnrollmentRuntime>>,
  { ok: true }
>;
type CliHomeEnrollmentCredential = ReturnType<typeof HomeLoginCredentialPayloadV1Schema.parse>;
type CliHomeEnrollmentAdapters = AccountServiceHomeEnrollmentAdapters<
  Uint8Array,
  CliHomeEnrollmentTransport,
  CliHomeEnrollmentCredential,
  string
>;

export type CliAccountServiceSetupEntryInput = Readonly<{
  /** Explicit override. When absent, the persisted selection remains authoritative. */
  endpoint?: string;
  expectedServerIdentityId?: string;
  promptInputFn?: typeof promptInput;
  promptSecretInputFn?: typeof promptSecretInput;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

const DEFAULT_ACCOUNT_SERVICE_ENDPOINT = 'https://api.happier.dev';

function endpointUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/u, '')}${path}`;
}

async function jsonRequest(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return await response.json();
}

type StoredAccountServiceCredentialValidation =
  | Readonly<{ kind: 'valid' }>
  | Readonly<{ kind: 'rejected' }>
  | Readonly<{ kind: 'account_service_unavailable' }>
  | Readonly<{ kind: 'cancelled' }>;

async function validateStoredAccountServiceCredential(input: Readonly<{
  service: CliAccountServiceSelection;
  credential: Readonly<{ token: string }>;
  signal?: AbortSignal;
}>): Promise<StoredAccountServiceCredentialValidation> {
  if (input.signal?.aborted) return { kind: 'cancelled' };
  try {
    const response = await fetch(endpointUrl(input.service.endpoint, '/v1/account-directory/me'), {
      headers: { Authorization: `Bearer ${input.credential.token}` },
      signal: input.signal,
    });
    if (response.ok) return { kind: 'valid' };
    if (response.status === 401 || response.status === 403) return { kind: 'rejected' };
    return { kind: 'account_service_unavailable' };
  } catch {
    return input.signal?.aborted
      ? { kind: 'cancelled' }
      : { kind: 'account_service_unavailable' };
  }
}

function discoverMethods(features: Awaited<ReturnType<typeof fetchServerFeaturesSnapshot>> & { status: 'ready' }) {
  const methods = features.features.capabilities.auth.methods;
  const providers = features.features.capabilities.oauth.providers;
  const oauthProviderIds = [...new Set(methods.filter((method) => method.id !== 'key_challenge'
    && method.id !== 'mtls'
    && method.actions.some((action) => action.id === 'provision' && action.enabled && ['keyed', 'either'].includes(action.mode))
    && providers[method.id]?.configured === true
    && providers[method.id]?.enabled === true)
    .map((method) => method.id.trim().toLowerCase()).filter(Boolean))];
  return {
    keyLoginAvailable: features.features.capabilities.auth.keyChallenge.v2 === true,
    oauthProviderIds,
    preferredProvisionProviderId: oauthProviderIds[0] ?? null,
  };
}

type CliAccountServiceDiscoveryResult =
  | Readonly<{ kind: 'ready'; service: CliAccountServiceSelection }>
  | Readonly<{ kind: 'account_service_unavailable' }>
  | Readonly<{ kind: 'identity_mismatch' }>;

async function discoverService(
  input: CliAccountServiceSetupEntryInput & Readonly<{ endpoint: string }>,
): Promise<CliAccountServiceDiscoveryResult> {
  const endpoint = input.endpoint.trim().replace(/\/+$/u, '');
  const snapshot = await fetchServerFeaturesSnapshot({ serverUrl: endpoint, signal: input.signal, timeoutMs: input.timeoutMs });
  if (snapshot.status !== 'ready') return { kind: 'account_service_unavailable' };
  const capability = AccountDirectoryCapabilitiesSchema.safeParse(snapshot.features.capabilities.accountDirectory);
  const serverIdentityId = normalizeServerIdentityIdCapability(
    snapshot.features.capabilities.serverIdentity.serverIdentityId,
  );
  const canonicalServerUrl = snapshot.features.capabilities.server.canonicalServerUrl?.replace(/\/+$/u, '');
  if (!capability.success || !capability.data.homeDirectory || !serverIdentityId || !canonicalServerUrl) {
    return { kind: 'account_service_unavailable' };
  }
  if (input.expectedServerIdentityId && input.expectedServerIdentityId !== serverIdentityId) {
    return { kind: 'identity_mismatch' };
  }
  return {
    kind: 'ready',
    service: { endpoint, serverIdentityId, canonicalServerUrl, advertisedMethods: discoverMethods(snapshot) },
  };
}

async function chooseMethod(
  service: CliAccountServiceSelection,
  input: CliAccountServiceSetupEntryInput,
): Promise<Readonly<{ method: CliAccountServiceRequestedMethod; key?: Uint8Array }> | null> {
  const choices = [
    ...service.advertisedMethods.oauthProviderIds.map((providerId, index) => ({
      id: `provider:${providerId}`,
      keys: [String(index + 1), providerId],
      short: String(index + 1),
    })),
    ...(service.advertisedMethods.keyLoginAvailable ? [{ id: 'key', keys: ['k', 'key'], short: 'k' }] : []),
    { id: 'cancel', keys: ['x', 'cancel'], short: 'x' },
  ];
  if (choices.length === 1) return null;
  const promptInputFn = input.promptInputFn;
  if (!promptInputFn) return null;
  const selected = await promptMultipleChoice(
    ['How would you like to find your Homes?', ...service.advertisedMethods.oauthProviderIds.map((id, i) => `  ${i + 1}) Continue with ${id}`), ...(service.advertisedMethods.keyLoginAvailable ? ['  k) Use an account key'] : []), '  x) Cancel'].join('\n'),
    choices,
    { defaultId: choices[0]!.id, maxAttempts: 3, promptInputFn },
  );
  if (selected === 'cancel') return null;
  const methodSelection = selectAccountServiceAuthenticationMethod({
    advertised: service.advertisedMethods,
    requested: selected === 'key'
      ? { kind: 'key' }
      : { kind: 'oauth', providerId: selected.slice('provider:'.length) },
  });
  if (methodSelection.kind !== 'selected') return null;
  if (methodSelection.method.kind === 'oauth') {
    return { method: { kind: 'provider', providerId: methodSelection.method.providerId } };
  }
  const raw = await (input.promptSecretInputFn ?? promptSecretInput)('Account key: ');
  try {
    let key: Uint8Array;
    try {
      key = decodeBase64(raw.trim(), 'base64url');
    } catch {
      key = decodeBase64(raw.trim(), 'base64');
    }
    return key.byteLength === 32 ? { method: { kind: 'key' }, key } : null;
  } catch {
    return null;
  }
}

export async function runCliAccountServiceSetupEntry(
  input: CliAccountServiceSetupEntryInput,
): Promise<CliAccountServiceHomeEntryOutcome> {
  const session = createCliAccountServiceSessionOwner({ happyHomeDir: resolveHappyHomeDirFromEnvironment(process.env) });
  const persistedSelection = input.endpoint === undefined
    ? await session.readSelection()
    : null;
  const discovery = await discoverService({
    ...input,
    endpoint: input.endpoint ?? persistedSelection?.endpoint ?? DEFAULT_ACCOUNT_SERVICE_ENDPOINT,
    expectedServerIdentityId: input.endpoint === undefined
      ? persistedSelection?.serverIdentityId
      : input.expectedServerIdentityId,
  });
  if (discovery.kind !== 'ready') return { kind: discovery.kind };
  const service = discovery.service;
  await session.selectService(service);
  const storedCredential = await session.readCredential(service);
  let existingAuthentication: Extract<
    CliAccountServiceAuthenticationOutcome,
    { kind: 'authenticated' }
  > | null = null;
  if (storedCredential) {
    const validation = await validateStoredAccountServiceCredential({
      service,
      credential: storedCredential,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (validation.kind === 'valid') {
      existingAuthentication = {
        kind: 'authenticated',
        target: { endpoint: service.endpoint, serverIdentityId: service.serverIdentityId },
        credential: storedCredential,
      };
    } else if (validation.kind === 'rejected') {
      await session.rejectCredential(service);
    } else {
      return { kind: validation.kind };
    }
  }
  const selected = existingAuthentication ? null : await chooseMethod(service, input);
  const authenticationInput = existingAuthentication
    ? { existingAuthentication } as const
    : selected
      ? {
          method: selected.method,
          ...(selected.key ? { key: selected.key } : {}),
        } as const
      : null;
  if (!authenticationInput) return { kind: 'cancelled' };
  const profileIds = new Map<string, string>();

  return await runCliAccountServiceHomeEntry({
    service: { endpoint: service.endpoint, expectedServerIdentityId: service.serverIdentityId },
    ...authenticationInput,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
  }, {
    authenticateExactMethod: async ({ method, key, signal, timeoutMs }) => {
      const auth = await session.authenticate({
        service,
        timeoutMs: timeoutMs ?? 300_000,
        ...(signal ? { signal } : {}),
        acquireCredential: async (authSignal) => {
          const result = await authenticateCliAccountService({ service, method, ...(key ? { key } : {}), signal: authSignal, timeoutMs });
          if (result.kind !== 'authenticated') throw Object.assign(new Error(result.kind), { outcome: result.kind });
          return result.credential;
        },
      });
      if (auth.kind !== 'authenticated') {
        if (auth.kind === 'timed_out') return { kind: 'timed_out' };
        if (auth.kind === 'cancelled') return { kind: 'cancelled' };
        const outcome = typeof auth.error === 'object' && auth.error !== null && 'outcome' in auth.error
          ? (auth.error as { outcome?: unknown }).outcome
          : null;
        if (outcome === 'key_required') return { kind: 'key_required' };
        if (outcome === 'update_required') return { kind: 'update_required' };
        if (outcome === 'account_service_unavailable') return { kind: 'account_service_unavailable' };
        if (outcome === 'identity_mismatch') return { kind: 'identity_mismatch' };
        if (outcome === 'destination_mismatch') return { kind: 'destination_mismatch' };
        return { kind: 'failed' };
      }
      const credential = await session.readCredential(service);
      return credential ? { kind: 'authenticated', target: service, credential } : { kind: 'failed' };
    },
    runDirectoryJourney: async ({ credential, signal }) => {
      try {
        const directory = AccountDirectoryHomesResponseV1Schema.parse(await jsonRequest(
          endpointUrl(service.endpoint, ACCOUNT_DIRECTORY_HOMES_HTTP_PATH_V1),
          { headers: { Authorization: `Bearer ${credential.token}` }, signal },
        ));
        const enrollmentAdapters: CliHomeEnrollmentAdapters = {
            createRequesterKeyPair: async () => {
              const pair = tweetnacl.box.keyPair();
              return { publicKeyBase64: encodeBase64(pair.publicKey), secretKey: pair.secretKey };
            },
            requestAssertion: async ({ homeServerIdentityId, clientBoxPublicKeyBase64 }) => HomeLoginAssertionResponseV1Schema.parse(await jsonRequest(
              endpointUrl(service.endpoint, buildAccountDirectoryHomeLoginAssertionHttpPathV1(homeServerIdentityId)),
              { method: 'POST', headers: { Authorization: `Bearer ${credential.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, homeServerIdentityId, clientBoxPublicKeyBase64 }), signal },
            )),
            openHomeTransport: async (home) => {
              const acquired = await acquireTerminalAuthEnrollmentRuntime(home.connectionDescriptor);
              if (!acquired.ok) throw acquired.error;
              return { transport: acquired, authenticatedCredentialDestination: acquired.runtime.authenticatedCredentialDestination! };
            },
            observeHomeBeforeRedemption: async ({ transport, home }) => {
              const observed = await fetchServerFeaturesSnapshot({ serverUrl: transport.runtime.runtimeOrigin, signal });
              if (observed.status !== 'ready' || !observed.features.homeConnectionDescriptor) throw new Error('Home observation unavailable');
              return { homeServerIdentityId: observed.features.capabilities.serverIdentity.serverIdentityId!, connectionDescriptor: observed.features.homeConnectionDescriptor };
            },
            redeemAssertion: async ({ transport, assertion, approvalId }) => HomeLoginRedemptionResultV1Schema.parse(await jsonRequest(
              endpointUrl(transport.runtime.runtimeOrigin, HOME_LOGIN_HTTP_PATH_V1),
              { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, assertion, ...(approvalId ? { approvalId } : {}) }), signal },
            )),
            decodeHomeCredential: async ({ redemption, secretKey }) => {
              const opened = libsodiumDecryptForSecretKey(decodeBase64(redemption.sealedHomeTokenBase64Url, 'base64url'), secretKey);
              if (!opened) return null;
              try { return HomeLoginCredentialPayloadV1Schema.parse(JSON.parse(new TextDecoder().decode(opened))); } catch { return null; }
            },
            observeAuthenticatedHome: async ({ transport, credential }) => {
              const observed = await fetchServerFeaturesSnapshot({ serverUrl: transport.runtime.runtimeOrigin, token: credential.token, signal });
              if (observed.status !== 'ready' || !observed.features.homeConnectionDescriptor) throw new Error('Authenticated Home observation unavailable');
              return { homeServerIdentityId: observed.features.capabilities.serverIdentity.serverIdentityId!, connectionDescriptor: observed.features.homeConnectionDescriptor };
            },
            commitHomeCredential: async ({ transport, home, credential }) => {
              const profileId = profileIds.get(home.homeServerIdentityId);
              if (!profileId) throw new Error('Home profile was not adopted');
              const storedCredential = { token: credential.token, encryption: null } as const;
              await writeCredentialsTokenOnlyForServerId(profileId, storedCredential);
              await runWithServerProfileSelection(profileId, async () => {
                await registerMachineWithAuthenticatedHomeRuntime({
                  credentials: storedCredential,
                  forceNew: true,
                  runtimeOrigin: transport.runtime.runtimeOrigin,
                });
              });
              return profileId;
            },
            reconcileAuthenticatedHome: async ({ home, observation }) => {
              const profileId = profileIds.get(home.homeServerIdentityId);
              if (!profileId) throw new Error('Home profile was not adopted');
              const reconciliation = await adoptServerProfileHomeConnectionDescriptor({
                descriptor: observation.connectionDescriptor,
                expectedProfileId: profileId,
                observation: 'exact',
              });
              if (reconciliation.outcome !== 'updated' && reconciliation.outcome !== 'unchanged') {
                throw new Error(`Authenticated Home reconciliation was not applied: ${reconciliation.outcome}`);
              }
            },
            closeHomeTransport: async (transport) => await transport.close(),
          };
        const mapEnrollment = async (
          homeServerIdentityId: string,
          enrollment: AccountServiceHomeEnrollmentResult<Uint8Array, string>,
        ): Promise<CliAccountServiceDirectoryAttemptOutcome> => {
          if (enrollment.kind === 'enrolled') {
            return { kind: 'preferred_home_enrolled', homeServerIdentityId, profileId: enrollment.commit };
          }
          if (enrollment.kind === 'approval_required') {
            const approval: AccountServiceHomeApproval<Uint8Array> = enrollment.approval;
            return {
              kind: 'awaiting_approval',
              homeServerIdentityId,
              expiresAtMs: approval.expiresAtMs,
              resume: async ({ signal: resumeSignal }) => await mapEnrollment(
                homeServerIdentityId,
                await observeAccountServiceHomeApproval({
                  approval,
                  adapters: enrollmentAdapters,
                  nowMs: Date.now(),
                  shouldCancel: () => resumeSignal.aborted,
                }),
              ),
            };
          }
          if (enrollment.kind === 'cancelled') return { kind: 'cancelled' };
          if (enrollment.kind === 'verification_failed') {
            const reason = enrollment.reason;
            return {
              kind: reason.includes('identity')
                ? 'identity_mismatch'
                : reason.includes('destination')
                  ? 'destination_mismatch'
                  : 'failed',
            };
          }
          return { kind: 'home_unavailable' };
        };
        const journey = await runAccountServiceDirectoryJourney({
          directory,
          issuerServerIdentityId: service.serverIdentityId,
          shouldCancel: () => signal?.aborted === true,
          adoptHome: async (home) => {
            const adopted = await adoptServerProfileHomeConnectionDescriptor({
              descriptor: home.connectionDescriptor, suggestedName: home.label, observation: 'advisory',
            });
            profileIds.set(home.homeServerIdentityId, adopted.profile.id);
          },
          enrollmentAdapters,
        });
        if (journey.kind === 'preferred_home_enrolled') return await mapEnrollment(journey.homeServerIdentityId, journey.enrollment);
        if (journey.kind === 'no_linked_homes' || journey.kind === 'no_preferred_home') return journey;
        if (journey.kind === 'preferred_home_awaiting_approval') return await mapEnrollment(journey.homeServerIdentityId, journey.enrollment);
        if (journey.kind === 'cancelled') return { kind: 'cancelled' };
        if (journey.kind === 'invalid_directory') return { kind: 'identity_mismatch' };
        if (journey.enrollment.kind === 'cancelled') return { kind: 'cancelled' };
        if (journey.enrollment.kind === 'verification_failed') {
          const reason = journey.enrollment.reason;
          return { kind: reason.includes('identity') ? 'identity_mismatch' : reason.includes('destination') ? 'destination_mismatch' : 'failed' };
        }
        return { kind: 'home_unavailable' };
      } catch {
        return { kind: 'account_service_unavailable' };
      }
    },
    openPreferredHome: async ({ profileId }) => {
      try { await useServerProfile(profileId); return { kind: 'opened' }; } catch { return { kind: 'home_unavailable' }; }
    },
    // Enrollment commits the credential and machine registration while its
    // authenticated carrier is still alive. Setup owns the later service pass.
    continueMachineAndService: async () => ({ kind: 'continued' }),
  });
}
