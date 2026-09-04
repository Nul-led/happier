import {
  AccountDirectoryHomeEntryV1Schema,
  createHomeCredentialDestinationDigestV1,
  createHomeCredentialDestinationV1,
  isHomeCredentialDestinationAllowedV1,
  type AccountDirectoryHomeEntryV1,
  type HomeConnectionDescriptorV1,
  type HomeCredentialDestinationSelectionV1,
  type HomeLoginAssertionV1,
  type HomeLoginRedemptionResultV1,
} from '@happier-dev/protocol';

export type AccountServiceRequestedAuthenticationMethod =
  | Readonly<{ kind: 'key' }>
  | Readonly<{ kind: 'oauth'; providerId?: string | null }>;

export type AccountServiceAdvertisedAuthenticationMethods = Readonly<{
  keyLoginAvailable: boolean;
  oauthProviderIds: readonly string[];
}>;

export type AccountServiceAuthenticationMethodSelection =
  | Readonly<{ kind: 'selected'; method: Readonly<{ kind: 'key' } | { kind: 'oauth'; providerId: string }> }>
  | Readonly<{
      kind: 'requested_method_unavailable';
      requestedMethod: AccountServiceRequestedAuthenticationMethod;
    }>
  | Readonly<{ kind: 'no_authentication_method' }>;

function normalizeProviderId(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

/** Selects only from the exact methods advertised by the chosen Account Service. */
export function selectAccountServiceAuthenticationMethod(input: Readonly<{
  advertised: AccountServiceAdvertisedAuthenticationMethods;
  requested?: AccountServiceRequestedAuthenticationMethod;
}>): AccountServiceAuthenticationMethodSelection {
  const oauthProviderIds = [...new Set(input.advertised.oauthProviderIds
    .map(normalizeProviderId)
    .filter((providerId): providerId is string => providerId !== null))];
  const requested = input.requested;
  if (requested?.kind === 'key') {
    return input.advertised.keyLoginAvailable
      ? { kind: 'selected', method: { kind: 'key' } }
      : { kind: 'requested_method_unavailable', requestedMethod: requested };
  }
  if (requested?.kind === 'oauth') {
    const providerId = normalizeProviderId(requested.providerId);
    const selectedProviderId = providerId ?? oauthProviderIds[0] ?? null;
    return selectedProviderId && oauthProviderIds.includes(selectedProviderId)
      ? { kind: 'selected', method: { kind: 'oauth', providerId: selectedProviderId } }
      : { kind: 'requested_method_unavailable', requestedMethod: requested };
  }
  if (oauthProviderIds[0]) {
    return { kind: 'selected', method: { kind: 'oauth', providerId: oauthProviderIds[0] } };
  }
  if (input.advertised.keyLoginAvailable) {
    return { kind: 'selected', method: { kind: 'key' } };
  }
  return { kind: 'no_authentication_method' };
}

export type AccountServiceDirectoryProjection = Readonly<{
  homes: readonly AccountDirectoryHomeEntryV1[];
  preferredHomeServerIdentityId: string | null;
}>;

export type AccountServiceDirectoryClassification =
  | Readonly<{
      kind: 'ready';
      homes: readonly AccountDirectoryHomeEntryV1[];
      preferredHome: AccountDirectoryHomeEntryV1 | null;
    }>
  | Readonly<{
      kind: 'invalid';
      reason: 'home_identity_mismatch' | 'descriptor_mismatch' | 'invalid_directory';
      homeServerIdentityId: string | null;
    }>;

/** Validates the Directory's identity/descriptor invariants before any Home transport opens. */
export function classifyAccountServiceDirectory(
  directory: AccountServiceDirectoryProjection,
): AccountServiceDirectoryClassification {
  const seen = new Set<string>();
  for (const home of directory.homes) {
    const topLevelIdentity = typeof home.homeServerIdentityId === 'string'
      ? home.homeServerIdentityId.trim()
      : '';
    const descriptorIdentity = home.connectionDescriptor?.homeServerIdentityId;
    if (!topLevelIdentity || descriptorIdentity !== topLevelIdentity) {
      return {
        kind: 'invalid',
        reason: 'home_identity_mismatch',
        homeServerIdentityId: topLevelIdentity || null,
      };
    }
    if (home.connectionDescriptor.canonicalServerUrl !== home.canonicalServerUrl) {
      return {
        kind: 'invalid',
        reason: 'descriptor_mismatch',
        homeServerIdentityId: topLevelIdentity,
      };
    }
    if (!AccountDirectoryHomeEntryV1Schema.safeParse(home).success || seen.has(topLevelIdentity)) {
      return {
        kind: 'invalid',
        reason: 'invalid_directory',
        homeServerIdentityId: topLevelIdentity,
      };
    }
    seen.add(topLevelIdentity);
  }
  const preferredIdentity = directory.preferredHomeServerIdentityId;
  const preferredHome = preferredIdentity === null
    ? null
    : directory.homes.find((home) => home.homeServerIdentityId === preferredIdentity) ?? null;
  const preferredEntries = directory.homes.filter((home) => home.preferred);
  if (
    (preferredIdentity !== null && (!preferredHome || preferredEntries.length !== 1
      || preferredEntries[0]!.homeServerIdentityId !== preferredIdentity))
    || (preferredIdentity === null && preferredEntries.length !== 0)
  ) {
    return { kind: 'invalid', reason: 'invalid_directory', homeServerIdentityId: preferredIdentity };
  }
  return { kind: 'ready', homes: directory.homes, preferredHome };
}

export type AccountServiceDirectoryAdoptionTarget = Readonly<{
  homeServerIdentityId: string;
  label: string;
}>;

export type AccountServiceDirectoryAdoptionResult = Readonly<{
  kind: 'completed' | 'cancelled';
  adopted: readonly AccountServiceDirectoryAdoptionTarget[];
  failures: readonly (AccountServiceDirectoryAdoptionTarget & Readonly<{ error: unknown }>)[];
}>;

/** Adopts every valid Directory Home without owning or consulting client focus. */
export async function adoptAccountServiceDirectoryHomes(input: Readonly<{
  homes: readonly AccountDirectoryHomeEntryV1[];
  adoptHome: (home: AccountDirectoryHomeEntryV1) => Promise<unknown>;
  shouldCancel?: () => boolean;
}>): Promise<AccountServiceDirectoryAdoptionResult> {
  const adopted: AccountServiceDirectoryAdoptionTarget[] = [];
  const failures: Array<AccountServiceDirectoryAdoptionTarget & Readonly<{ error: unknown }>> = [];
  for (const home of input.homes) {
    if (input.shouldCancel?.()) return { kind: 'cancelled', adopted, failures };
    const target = { homeServerIdentityId: home.homeServerIdentityId, label: home.label };
    try {
      await input.adoptHome(home);
      adopted.push(target);
    } catch (error) {
      failures.push({ ...target, error });
    }
  }
  return { kind: input.shouldCancel?.() ? 'cancelled' : 'completed', adopted, failures };
}

export type AccountServiceAssertionVerificationFailureReason =
  | 'home_identity_mismatch'
  | 'descriptor_mismatch'
  | 'assertion_issuer_mismatch'
  | 'assertion_audience_mismatch'
  | 'requester_key_mismatch'
  | 'credential_destination_mismatch';

export type AccountServiceAssertionVerificationResult =
  | Readonly<{ kind: 'verified' }>
  | Readonly<{ kind: 'verification_failed'; reason: AccountServiceAssertionVerificationFailureReason }>;

/** Verifies the assertion and its exact Directory row before transport or redemption. */
export function verifyAccountServiceHomeAssertionRequest(input: Readonly<{
  home: AccountDirectoryHomeEntryV1;
  issuerServerIdentityId: string;
  requesterPublicKeyBase64: string;
  assertion: HomeLoginAssertionV1;
}>): AccountServiceAssertionVerificationResult {
  const { home, assertion } = input;
  if (home.connectionDescriptor.homeServerIdentityId !== home.homeServerIdentityId) {
    return { kind: 'verification_failed', reason: 'home_identity_mismatch' };
  }
  if (home.connectionDescriptor.canonicalServerUrl !== home.canonicalServerUrl) {
    return { kind: 'verification_failed', reason: 'descriptor_mismatch' };
  }
  if (assertion.issuerServerIdentityId !== input.issuerServerIdentityId) {
    return { kind: 'verification_failed', reason: 'assertion_issuer_mismatch' };
  }
  if (assertion.audienceHomeServerIdentityId !== home.homeServerIdentityId) {
    return { kind: 'verification_failed', reason: 'assertion_audience_mismatch' };
  }
  if (assertion.clientBoxPublicKeyBase64 !== input.requesterPublicKeyBase64) {
    return { kind: 'verification_failed', reason: 'requester_key_mismatch' };
  }
  try {
    if (
      assertion.credentialDestinationDigestBase64Url
      !== createHomeCredentialDestinationDigestV1(home.connectionDescriptor)
    ) {
      return { kind: 'verification_failed', reason: 'credential_destination_mismatch' };
    }
  } catch {
    return { kind: 'verification_failed', reason: 'descriptor_mismatch' };
  }
  return { kind: 'verified' };
}

export type AccountServiceAuthenticatedHomeObservation = Readonly<{
  homeServerIdentityId: string;
  connectionDescriptor: HomeConnectionDescriptorV1;
}>;

export function verifyAccountServiceAuthenticatedHomeObservation(input: Readonly<{
  home: AccountDirectoryHomeEntryV1;
  assertion: HomeLoginAssertionV1;
  observation: AccountServiceAuthenticatedHomeObservation;
}>): AccountServiceAssertionVerificationResult {
  if (input.observation.homeServerIdentityId !== input.home.homeServerIdentityId
    || input.observation.connectionDescriptor.homeServerIdentityId !== input.home.homeServerIdentityId) {
    return { kind: 'verification_failed', reason: 'home_identity_mismatch' };
  }
  try {
    if (
      createHomeCredentialDestinationDigestV1(input.observation.connectionDescriptor)
      !== input.assertion.credentialDestinationDigestBase64Url
    ) {
      return { kind: 'verification_failed', reason: 'credential_destination_mismatch' };
    }
  } catch {
    return { kind: 'verification_failed', reason: 'descriptor_mismatch' };
  }
  return { kind: 'verified' };
}

export type AccountServiceHomeEnrollmentAdapters<SecretKey, Transport, HomeCredential, Commit> = Readonly<{
  createRequesterKeyPair: () => Promise<Readonly<{
    publicKeyBase64: string;
    secretKey: SecretKey;
  }>>;
  requestAssertion: (input: Readonly<{
    homeServerIdentityId: string;
    clientBoxPublicKeyBase64: string;
  }>) => Promise<HomeLoginAssertionV1>;
  openHomeTransport: (home: AccountDirectoryHomeEntryV1) => Promise<Readonly<{
    transport: Transport;
    authenticatedCredentialDestination: HomeCredentialDestinationSelectionV1;
  }>>;
  observeHomeBeforeRedemption: (input: Readonly<{
    transport: Transport;
    home: AccountDirectoryHomeEntryV1;
  }>) => Promise<AccountServiceAuthenticatedHomeObservation>;
  redeemAssertion: (input: Readonly<{
    transport: Transport;
    assertion: HomeLoginAssertionV1;
    approvalId?: string;
  }>) => Promise<HomeLoginRedemptionResultV1>;
  decodeHomeCredential: (input: Readonly<{
    redemption: Exclude<HomeLoginRedemptionResultV1, { outcome: 'approval_required' }>;
    secretKey: SecretKey;
  }>) => Promise<HomeCredential | null>;
  observeAuthenticatedHome: (input: Readonly<{
    transport: Transport;
    credential: HomeCredential;
    home: AccountDirectoryHomeEntryV1;
  }>) => Promise<AccountServiceAuthenticatedHomeObservation>;
  commitHomeCredential: (input: Readonly<{
    transport: Transport;
    home: AccountDirectoryHomeEntryV1;
    assertion: HomeLoginAssertionV1;
    credential: HomeCredential;
    observation: AccountServiceAuthenticatedHomeObservation;
  }>) => Promise<Commit>;
  reconcileAuthenticatedHome: (input: Readonly<{
    home: AccountDirectoryHomeEntryV1;
    assertion: HomeLoginAssertionV1;
    observation: AccountServiceAuthenticatedHomeObservation;
  }>) => Promise<void>;
  closeHomeTransport: (transport: Transport) => Promise<void>;
}>;

export type AccountServiceHomeApproval<SecretKey> = Readonly<{
  approvalId: string;
  homeServerIdentityId: string;
  expiresAtMs: number;
  home: AccountDirectoryHomeEntryV1;
  assertion: HomeLoginAssertionV1;
  requesterSecretKey: SecretKey;
}>;

export type AccountServiceHomeEnrollmentResult<SecretKey, Commit> =
  | Readonly<{ kind: 'enrolled'; commit: Commit }>
  | Readonly<{ kind: 'approval_required'; approval: AccountServiceHomeApproval<SecretKey> }>
  | Readonly<{ kind: 'verification_failed'; reason: AccountServiceAssertionVerificationFailureReason | 'transport_destination_mismatch' | 'redemption_identity_mismatch' | 'approval_mismatch' | 'redemption_expired' | 'credential_invalid' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; error: unknown }>;

export async function continueAccountServiceHomeEnrollment<SecretKey, Transport, HomeCredential, Commit>(input: Readonly<{
  home: AccountDirectoryHomeEntryV1;
  assertion: HomeLoginAssertionV1;
  requesterSecretKey: SecretKey;
  approvalId?: string;
  adapters: AccountServiceHomeEnrollmentAdapters<SecretKey, Transport, HomeCredential, Commit>;
  nowMs: number;
  shouldCancel?: () => boolean;
}>): Promise<AccountServiceHomeEnrollmentResult<SecretKey, Commit>> {
  if (input.shouldCancel?.()) return { kind: 'cancelled' };
  let opened: Awaited<ReturnType<typeof input.adapters.openHomeTransport>>;
  try {
    opened = await input.adapters.openHomeTransport(input.home);
  } catch (error) {
    return { kind: 'unavailable', error };
  }
  try {
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    if (input.assertion.audienceHomeServerIdentityId !== input.home.homeServerIdentityId) {
      return { kind: 'verification_failed', reason: 'assertion_audience_mismatch' };
    }
    try {
      if (createHomeCredentialDestinationDigestV1(input.home.connectionDescriptor)
        !== input.assertion.credentialDestinationDigestBase64Url) {
        return { kind: 'verification_failed', reason: 'credential_destination_mismatch' };
      }
    } catch {
      return { kind: 'verification_failed', reason: 'descriptor_mismatch' };
    }
    const destination = createHomeCredentialDestinationV1(input.home.connectionDescriptor);
    if (!isHomeCredentialDestinationAllowedV1(
      destination,
      opened.authenticatedCredentialDestination,
    )) {
      return { kind: 'verification_failed', reason: 'transport_destination_mismatch' };
    }
    const preRedemptionObservation = await input.adapters.observeHomeBeforeRedemption({
      transport: opened.transport,
      home: input.home,
    });
    const verifiedPreRedemptionObservation = verifyAccountServiceAuthenticatedHomeObservation({
      home: input.home,
      assertion: input.assertion,
      observation: preRedemptionObservation,
    });
    if (verifiedPreRedemptionObservation.kind !== 'verified') return verifiedPreRedemptionObservation;
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    const redemption = await input.adapters.redeemAssertion({
      transport: opened.transport,
      assertion: input.assertion,
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    });
    if ('outcome' in redemption) {
      if (redemption.homeServerIdentityId !== input.home.homeServerIdentityId) {
        return { kind: 'verification_failed', reason: 'redemption_identity_mismatch' };
      }
      if (redemption.expiresAtMs <= input.nowMs) {
        return { kind: 'verification_failed', reason: 'redemption_expired' };
      }
      if (input.approvalId && redemption.approvalId !== input.approvalId) {
        return { kind: 'verification_failed', reason: 'approval_mismatch' };
      }
      return {
        kind: 'approval_required',
        approval: Object.freeze({
          approvalId: redemption.approvalId,
          homeServerIdentityId: redemption.homeServerIdentityId,
          expiresAtMs: redemption.expiresAtMs,
          home: input.home,
          assertion: input.assertion,
          requesterSecretKey: input.requesterSecretKey,
        }),
      };
    }
    if (redemption.homeServerIdentityId !== input.home.homeServerIdentityId) {
      return { kind: 'verification_failed', reason: 'redemption_identity_mismatch' };
    }
    if (redemption.expiresAtMs <= redemption.issuedAtMs || redemption.expiresAtMs <= input.nowMs) {
      return { kind: 'verification_failed', reason: 'redemption_expired' };
    }
    const credential = await input.adapters.decodeHomeCredential({
      redemption,
      secretKey: input.requesterSecretKey,
    });
    if (credential === null) return { kind: 'verification_failed', reason: 'credential_invalid' };
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    const observation = await input.adapters.observeAuthenticatedHome({
      transport: opened.transport,
      credential,
      home: input.home,
    });
    const verifiedObservation = verifyAccountServiceAuthenticatedHomeObservation({
      home: input.home,
      assertion: input.assertion,
      observation,
    });
    if (verifiedObservation.kind !== 'verified') return verifiedObservation;
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    await input.adapters.reconcileAuthenticatedHome({
      home: input.home,
      assertion: input.assertion,
      observation,
    });
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    const commit = await input.adapters.commitHomeCredential({
      transport: opened.transport,
      home: input.home,
      assertion: input.assertion,
      credential,
      observation,
    });
    return { kind: 'enrolled', commit };
  } catch (error) {
    return { kind: 'unavailable', error };
  } finally {
    await input.adapters.closeHomeTransport(opened.transport).catch(() => {});
  }
}

export async function enrollPreferredAccountServiceHome<SecretKey, Transport, HomeCredential, Commit>(input: Readonly<{
  home: AccountDirectoryHomeEntryV1;
  issuerServerIdentityId: string;
  adapters: AccountServiceHomeEnrollmentAdapters<SecretKey, Transport, HomeCredential, Commit>;
  nowMs?: number;
  shouldCancel?: () => boolean;
}>): Promise<AccountServiceHomeEnrollmentResult<SecretKey, Commit>> {
  if (input.shouldCancel?.()) return { kind: 'cancelled' };
  let keyPair: Awaited<ReturnType<typeof input.adapters.createRequesterKeyPair>>;
  let assertion: HomeLoginAssertionV1;
  try {
    keyPair = await input.adapters.createRequesterKeyPair();
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    assertion = await input.adapters.requestAssertion({
      homeServerIdentityId: input.home.homeServerIdentityId,
      clientBoxPublicKeyBase64: keyPair.publicKeyBase64,
    });
  } catch (error) {
    return { kind: 'unavailable', error };
  }
  const verification = verifyAccountServiceHomeAssertionRequest({
    home: input.home,
    issuerServerIdentityId: input.issuerServerIdentityId,
    requesterPublicKeyBase64: keyPair.publicKeyBase64,
    assertion,
  });
  if (verification.kind !== 'verified') return verification;
  return await continueAccountServiceHomeEnrollment({
    home: input.home,
    assertion,
    requesterSecretKey: keyPair.secretKey,
    adapters: input.adapters,
    nowMs: input.nowMs ?? Date.now(),
    shouldCancel: input.shouldCancel,
  });
}

export async function observeAccountServiceHomeApproval<SecretKey, Transport, HomeCredential, Commit>(input: Readonly<{
  approval: AccountServiceHomeApproval<SecretKey>;
  adapters: AccountServiceHomeEnrollmentAdapters<SecretKey, Transport, HomeCredential, Commit>;
  nowMs?: number;
  shouldCancel?: () => boolean;
}>): Promise<AccountServiceHomeEnrollmentResult<SecretKey, Commit>> {
  const nowMs = input.nowMs ?? Date.now();
  if (input.approval.expiresAtMs <= nowMs) {
    return { kind: 'verification_failed', reason: 'redemption_expired' };
  }
  return await continueAccountServiceHomeEnrollment({
    home: input.approval.home,
    assertion: input.approval.assertion,
    requesterSecretKey: input.approval.requesterSecretKey,
    approvalId: input.approval.approvalId,
    adapters: input.adapters,
    nowMs,
    shouldCancel: input.shouldCancel,
  });
}

export type AccountServiceDirectoryJourneyResult<SecretKey, Commit> =
  | Readonly<{
      kind: 'preferred_home_enrolled';
      homeServerIdentityId: string;
      adoption: AccountServiceDirectoryAdoptionResult;
      enrollment: Extract<AccountServiceHomeEnrollmentResult<SecretKey, Commit>, { kind: 'enrolled' }>;
    }>
  | Readonly<{
      kind: 'preferred_home_awaiting_approval';
      homeServerIdentityId: string;
      adoption: AccountServiceDirectoryAdoptionResult;
      enrollment: Extract<AccountServiceHomeEnrollmentResult<SecretKey, Commit>, { kind: 'approval_required' }>;
    }>
  | Readonly<{
      kind: 'preferred_home_failed';
      homeServerIdentityId: string | null;
      adoption: AccountServiceDirectoryAdoptionResult;
      enrollment: Exclude<AccountServiceHomeEnrollmentResult<SecretKey, Commit>, { kind: 'enrolled' | 'approval_required' }>;
    }>
  | Readonly<{ kind: 'no_linked_homes'; adoption: AccountServiceDirectoryAdoptionResult }>
  | Readonly<{ kind: 'no_preferred_home'; adoption: AccountServiceDirectoryAdoptionResult }>
  | Readonly<{ kind: 'cancelled'; adoption: AccountServiceDirectoryAdoptionResult }>
  | Readonly<{
      kind: 'invalid_directory';
      reason: Extract<AccountServiceDirectoryClassification, { kind: 'invalid' }>['reason'];
      homeServerIdentityId: string | null;
      adoption: AccountServiceDirectoryAdoptionResult;
      enrollment: Readonly<{
        kind: 'verification_failed';
        reason: Extract<AccountServiceDirectoryClassification, { kind: 'invalid' }>['reason'];
      }>;
    }>;

export async function runAccountServiceDirectoryJourney<SecretKey, Transport, HomeCredential, Commit>(input: Readonly<{
  directory: AccountServiceDirectoryProjection;
  issuerServerIdentityId: string;
  adoptHome: (home: AccountDirectoryHomeEntryV1) => Promise<unknown>;
  enrollmentAdapters: AccountServiceHomeEnrollmentAdapters<SecretKey, Transport, HomeCredential, Commit>;
  nowMs?: number;
  shouldCancel?: () => boolean;
}>): Promise<AccountServiceDirectoryJourneyResult<SecretKey, Commit>> {
  const classification = classifyAccountServiceDirectory(input.directory);
  if (classification.kind === 'invalid') {
    const adoption = { kind: 'completed', adopted: [], failures: [] } as const;
    return {
      kind: classification.homeServerIdentityId ? 'preferred_home_failed' : 'invalid_directory',
      homeServerIdentityId: classification.homeServerIdentityId,
      adoption,
      enrollment: { kind: 'verification_failed', reason: classification.reason },
    } as AccountServiceDirectoryJourneyResult<SecretKey, Commit>;
  }
  const adoption = await adoptAccountServiceDirectoryHomes({
    homes: classification.homes,
    adoptHome: input.adoptHome,
    shouldCancel: input.shouldCancel,
  });
  if (adoption.kind === 'cancelled') return { kind: 'cancelled', adoption };
  if (classification.homes.length === 0) return { kind: 'no_linked_homes', adoption };
  if (!classification.preferredHome) return { kind: 'no_preferred_home', adoption };
  const enrollment = await enrollPreferredAccountServiceHome({
    home: classification.preferredHome,
    issuerServerIdentityId: input.issuerServerIdentityId,
    adapters: input.enrollmentAdapters,
    nowMs: input.nowMs,
    shouldCancel: input.shouldCancel,
  });
  if (enrollment.kind === 'enrolled') {
    return {
      kind: 'preferred_home_enrolled',
      homeServerIdentityId: classification.preferredHome.homeServerIdentityId,
      adoption,
      enrollment,
    };
  }
  if (enrollment.kind === 'approval_required') {
    return {
      kind: 'preferred_home_awaiting_approval',
      homeServerIdentityId: classification.preferredHome.homeServerIdentityId,
      adoption,
      enrollment,
    };
  }
  return {
    kind: 'preferred_home_failed',
    homeServerIdentityId: classification.preferredHome.homeServerIdentityId,
    adoption,
    enrollment,
  };
}

export type AccountServiceHomeLinkTarget = Pick<
  AccountDirectoryHomeEntryV1,
  'homeServerIdentityId' | 'canonicalServerUrl' | 'label' | 'connectionDescriptor'
>;

export type AccountServiceHomeLinkAdapters<HomeCredential, AccountServiceCredential> = Readonly<{
  readHomeCredential: (homeServerIdentityId: string) => Promise<HomeCredential | null>;
  readAccountServiceCredential: (issuerServerIdentityId: string) => Promise<AccountServiceCredential | null>;
  readAccountSubject: (credential: AccountServiceCredential) => Promise<string>;
  publishLinkToHome: (input: Readonly<{
    home: AccountServiceHomeLinkTarget;
    credential: HomeCredential;
    issuerServerIdentityId: string;
    issuerSubjectId: string;
    issuerSigningKeyId: string;
    issuerSigningPublicKeyBase64Url: string;
    relink: boolean;
  }>) => Promise<void>;
  publishHomeToAccountService: (input: Readonly<{
    home: AccountServiceHomeLinkTarget;
    credential: AccountServiceCredential;
  }>) => Promise<void>;
}>;

export type AccountServiceHomeLinkResult =
  | Readonly<{ kind: 'linked'; homeServerIdentityId: string }>
  | Readonly<{ kind: 'unavailable'; reason: 'home_credentials_unavailable' | 'account_service_credentials_unavailable' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'failed'; error: unknown }>;

/** Publishes a link while keeping Home and Account Service credential custody separate. */
export async function publishAccountServiceHomeLink<HomeCredential, AccountServiceCredential>(input: Readonly<{
  home: AccountServiceHomeLinkTarget;
  issuerServerIdentityId: string;
  issuerSigningKeyId: string;
  issuerSigningPublicKeyBase64Url: string;
  relink?: boolean;
  shouldCancel?: () => boolean;
  adapters: AccountServiceHomeLinkAdapters<HomeCredential, AccountServiceCredential>;
}>): Promise<AccountServiceHomeLinkResult> {
  if (input.shouldCancel?.()) return { kind: 'cancelled' };
  try {
    const [homeCredential, accountServiceCredential] = await Promise.all([
      input.adapters.readHomeCredential(input.home.homeServerIdentityId),
      input.adapters.readAccountServiceCredential(input.issuerServerIdentityId),
    ]);
    if (homeCredential === null) {
      return { kind: 'unavailable', reason: 'home_credentials_unavailable' };
    }
    if (accountServiceCredential === null) {
      return { kind: 'unavailable', reason: 'account_service_credentials_unavailable' };
    }
    const issuerSubjectId = (await input.adapters.readAccountSubject(accountServiceCredential)).trim();
    if (!issuerSubjectId) return { kind: 'failed', error: new Error('account_service_subject_unavailable') };
    if (input.shouldCancel?.()) return { kind: 'cancelled' };
    await input.adapters.publishLinkToHome({
      home: input.home,
      credential: homeCredential,
      issuerServerIdentityId: input.issuerServerIdentityId,
      issuerSubjectId,
      issuerSigningKeyId: input.issuerSigningKeyId,
      issuerSigningPublicKeyBase64Url: input.issuerSigningPublicKeyBase64Url,
      relink: input.relink === true,
    });
    await input.adapters.publishHomeToAccountService({
      home: input.home,
      credential: accountServiceCredential,
    });
    return { kind: 'linked', homeServerIdentityId: input.home.homeServerIdentityId };
  } catch (error) {
    return { kind: 'failed', error };
  }
}
