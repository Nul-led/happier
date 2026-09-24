import React, { useState } from 'react';
import { useAuth } from '@/auth/context/AuthContext';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useProfile, useSettingMutable } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { Switch } from '@/components/ui/forms/Switch';
import { HappyError } from '@/utils/errors/errors';
import { storage } from '@/sync/domains/state/storageStore';
import { isLegacyAuthCredentials, isTokenOnlyAuthCredentials } from '@/auth/storage/tokenStorage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { fetchAccountEncryptionCurrentness, fetchAccountEncryptionMode, getAccountEncryptionModeScopeKey } from '@/sync/api/account/apiAccountEncryptionMode';
import { migrateAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMigrate';
import { useRouter } from 'expo-router';
import { buildAccountEncryptionMigrateToPlainRequest } from '@/sync/ops/account/buildAccountEncryptionMigrateToPlainRequest';
import { getConnectedServiceCredentialSealed } from '@/sync/api/account/apiConnectedServicesV2';
import { buildAccountEncryptionMigrateToE2eeRequest } from '@/sync/ops/account/buildAccountEncryptionMigrateToE2eeRequest';
import { getConnectedServiceCredentialPlain } from '@/sync/api/account/apiConnectedServicesV3';
import { getQualifiedConnectedAccountConfigurationV4, getQualifiedConnectedAccountCredentialV4 } from '@/sync/api/account/apiQualifiedConnectedAccountsV4';
import { AccountEncryptionMigrateInvalidParamsReasonSchema, AccountEncryptionMigrateRequestSchema, createAccountEncryptionMigrateRequestBindingDigestV1, type AccountEncryptionMigrateRequest } from '@happier-dev/protocol';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import { fetchMachineRows } from '@/sync/engine/machines/syncMachines';
import { kvList } from '@/sync/api/account/apiKv';
import { fetchArtifact, fetchArtifacts } from '@/sync/api/artifacts/apiArtifacts';
import { buildAccountEncryptionMigrationStorageDirectives } from '@/sync/ops/account/buildAccountEncryptionMigrationStorageDirectives';
import { fetchAccountEncryptionMigrationSessionInventory } from '@/sync/ops/account/fetchAccountEncryptionMigrationSessionInventory';
import { fetchReviewCommentAccountEncryptionMigrationInventory } from '@/sync/domains/reviews/comments/accountEncryptionMigrationApi';
import { fetchSessionOrganizationAccountEncryptionMigrationInventory } from '@/sync/ops/account/fetchSessionOrganizationAccountEncryptionMigrationInventory';
import { prepareAccountEncryptionMigrateToE2eeKey } from '@/sync/ops/account/prepareAccountEncryptionMigrateToE2eeKey';
import { openAccountEncryptionFirstKeyExternalAuthUrl, requestAccountEncryptionFirstKeyPasswordProof, retryPendingAccountEncryptionFirstKeyExternalAuth, resumeAccountEncryptionFirstKeyExternalAuth, startAccountEncryptionFirstKeyExternalAuth } from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';
import { runTasksWithLimit } from '@/sync/runtime/orchestration/runTasksWithLimit';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { acknowledgeNewSessionDraftEncryptionMigration, listNewSessionDraftEncryptionMigrationCandidates } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { runAccountEncryptionModeMigration } from '@/sync/ops/account/runAccountEncryptionModeMigration';
import { prepareAccountEncryptionModePasswordCredential } from '@/sync/api/auth/accountSecurity';
import { serverFetch } from '@/sync/http/client';
import { decodeBase64 } from '@/encryption/base64';
import { createAccountSecurityActionClient } from './accountSecurityActionClient';
import { resolveHomeKeyChallengeExpectedAudience } from '@/auth/flows/resolveHomeAuthenticationTarget';
import { resolveUiClientEncryptionRequirement } from '@/sync/domains/settings/clientEncryptionRequirement';

type AccountEncryptionModePresentation = Readonly<{
    scope: string | null;
    mode: 'e2ee' | 'plain' | null;
    recoveryRequired: boolean;
}>;

export const AccountEncryptionSettingsSection = React.memo(function AccountEncryptionSettingsSection() {
    const auth = useAuth();
    const router = useRouter();
    const profile = useProfile();
    const [clientEncryptionRequirement, setClientEncryptionRequirement] = useSettingMutable('clientEncryptionRequirementV1');
    const [clientEncryptionRequirementLocal, setClientEncryptionRequirementLocal] = useSettingMutable('clientEncryptionRequirementLocalV1');
    const encryptionAccountOptOutEnabled = useFeatureEnabled('encryption.accountOptOut');
    const sessionDraftSyncEnabled = useFeatureEnabled('sessions.drafts');
    const activeServer = useActiveServerSnapshot();
    const accountSecurityClient = React.useMemo(() => createAccountSecurityActionClient(), []);
    const accountEncryptionScope = auth.credentials
        ? getAccountEncryptionModeScopeKey(auth.credentials, activeServer)
        : null;

    const [accountEncryptionPresentation, setAccountEncryptionPresentation] =
        useState<AccountEncryptionModePresentation>({
            scope: null,
            mode: null,
            recoveryRequired: false,
        });
    const [accountEncryptionModeLoading, setAccountEncryptionModeLoading] = useState(false);
    const [accountEncryptionModeSaving, setAccountEncryptionModeSaving] = useState(false);
    const accountEncryptionPresentationIsCurrent =
        accountEncryptionScope !== null
        && accountEncryptionPresentation.scope === accountEncryptionScope;
    const accountEncryptionMode = accountEncryptionPresentationIsCurrent
        ? accountEncryptionPresentation.mode
        : null;
    const accountEncryptionRecoveryRequired =
        accountEncryptionPresentationIsCurrent
        && accountEncryptionPresentation.recoveryRequired;
    const effectiveClientEncryptionRequirement = resolveUiClientEncryptionRequirement({
        syncedSettings: { clientEncryptionRequirementV1: clientEncryptionRequirement },
        localSettings: { clientEncryptionRequirementLocalV1: clientEncryptionRequirementLocal },
    });
    const publishAccountEncryptionPresentation = React.useCallback(
        (
            scope: string | null,
            mode: 'e2ee' | 'plain' | null,
            recoveryRequired = false,
        ) => {
            setAccountEncryptionPresentation({
                scope,
                mode,
                recoveryRequired,
            });
        },
        [],
    );
    const firstKeyRecoveryAttemptedTokenRef =
        React.useRef<string | null>(null);

    React.useEffect(() => {
        if (!encryptionAccountOptOutEnabled) return;
        const credentials = auth.credentials;
        const presentationScope = accountEncryptionScope;
        if (!credentials?.token || !presentationScope) return;
        const credentialsToken = credentials.token;

        let cancelled = false;
        const handleAccountEncryptionModeError = async (
            error: unknown,
        ): Promise<void> => {
            if (cancelled) return;
            if (
                error instanceof HappyError
                && error.code === 'account-encryption-recovery-required'
            ) {
                publishAccountEncryptionPresentation(
                    presentationScope,
                    null,
                    true,
                );
                return;
            }
            await Modal.alertAsync(
                t('common.error'),
                error instanceof HappyError
                    ? error.message
                    : t(
                        'settingsAccount.encryptionUpdateFailed',
                    ),
            );
        };
        setAccountEncryptionModeLoading(true);
        publishAccountEncryptionPresentation(
            presentationScope,
            null,
            false,
        );
        fetchAccountEncryptionMode(credentials)
            .then(async (res) => {
                if (cancelled) return;
                try {
                    if (
                        res.mode === 'plain'
                        && !isTokenOnlyAuthCredentials(credentials)
                    ) {
                        const credentialReplacement =
                            await auth.loginWithCredentials({
                                token: credentialsToken,
                            });
                        if (credentialReplacement.kind !== 'completed') {
                            throw new Error(
                                'Plain Account credentials could not be persisted',
                            );
                        }
                        if (cancelled) return;
                    }
                    publishAccountEncryptionPresentation(
                        presentationScope,
                        res.mode,
                    );
                    const recoveryAttemptKey =
                        isLegacyAuthCredentials(credentials)
                            ? [
                                credentials.token,
                                credentials.secret,
                            ].join('\u0000')
                            : credentials.token;
                    if (
                        res.mode !== 'e2ee'
                        || firstKeyRecoveryAttemptedTokenRef.current
                            === recoveryAttemptKey
                    ) {
                        return;
                    }
                    firstKeyRecoveryAttemptedTokenRef.current =
                        recoveryAttemptKey;
                    const replayed =
                        await retryPendingAccountEncryptionFirstKeyExternalAuth({
                            currentCredentials: credentials,
                            persistCredentials:
                                auth.loginWithCredentials,
                        });
                    if (cancelled || !replayed) return;
                    publishAccountEncryptionPresentation(
                        presentationScope,
                        replayed.mode,
                    );
                } catch (error) {
                    await handleAccountEncryptionModeError(error);
                }
            })
            .catch(handleAccountEncryptionModeError)
            .finally(() => {
                if (cancelled) return;
                setAccountEncryptionModeLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [
        auth.credentials,
        accountEncryptionScope,
        encryptionAccountOptOutEnabled,
        publishAccountEncryptionPresentation,
    ]);

    return (<>
                {/* Analytics Section */}
                {encryptionAccountOptOutEnabled && (
                    <ItemGroup title={t('terminal.encryption')}>
                        <Item
                            title={t('settingsAccount.requireE2ee')}
                            subtitle={t('settingsAccount.requireE2eeDescription')}
                            rightElement={
                                <Switch
                                    testID="settings-account-client-encryption-requirement-switch"
                                    value={effectiveClientEncryptionRequirement === 'require_e2ee'}
                                    disabled={
                                        accountEncryptionModeLoading
                                        || accountEncryptionModeSaving
                                        || accountEncryptionMode == null
                                    }
                                    onValueChange={async (enabled) => {
                                        if (enabled && accountEncryptionMode !== 'e2ee') {
                                            await Modal.alertAsync(
                                                t('settingsAccount.requireE2eeNeedsEncryptionTitle'),
                                                t('settingsAccount.requireE2eeNeedsEncryptionDescription'),
                                            );
                                            return;
                                        }
                                        const nextRequirement = enabled ? 'require_e2ee' : 'follow_account';
                                        if (enabled) {
                                            setClientEncryptionRequirementLocal(nextRequirement);
                                            setClientEncryptionRequirement(nextRequirement);
                                        } else {
                                            setClientEncryptionRequirement(nextRequirement);
                                            setClientEncryptionRequirementLocal(nextRequirement);
                                        }
                                    }}
                                />
                            }
                            showChevron={false}
                        />
                        {accountEncryptionRecoveryRequired ? (
                            <Item
                                testID="settings-account-encryption-recovery"
                                title={t('navigation.restoreWithSecretKey')}
                                subtitle={t('settingsAccount.restoreRequiredBody')}
                                onPress={() => router.push('/restore/manual')}
                            />
                        ) : null}
                        <Item
                            title={t('terminal.endToEndEncrypted')}
                            rightElement={
                                <Switch
                                    testID="settings-account-encryption-mode-switch"
                                    value={(accountEncryptionMode ?? 'e2ee') === 'e2ee'}
                                    disabled={
                                        accountEncryptionModeLoading ||
                                        accountEncryptionModeSaving ||
                                        effectiveClientEncryptionRequirement === 'require_e2ee' ||
                                        !auth.credentials ||
                                        accountEncryptionMode == null
                                    }
                                    onValueChange={async (enabled) => {
                                        if (!auth.credentials) return;
                                        if (accountEncryptionMode == null) return;
                                        const credentials = auth.credentials;
                                        const presentationScope =
                                            accountEncryptionScope;
                                        const credentialsToken =
                                            credentials.token;
                                        const nextMode = enabled ? 'e2ee' : 'plain';
                                        const sourceEncryption = sync.encryption;

                                        setAccountEncryptionModeSaving(true);
                                        try {
                                            if (
                                                nextMode === 'e2ee'
                                                && isTokenOnlyAuthCredentials(
                                                    credentials,
                                                )
                                            ) {
                                                const replayed =
                                                    await retryPendingAccountEncryptionFirstKeyExternalAuth({
                                                        currentCredentials:
                                                            credentials,
                                                        persistCredentials:
                                                            auth.loginWithCredentials,
                                                    });
                                                if (replayed) {
                                                    publishAccountEncryptionPresentation(
                                                        presentationScope,
                                                        replayed.mode,
                                                    );
                                                    return;
                                                }
                                            }
                                            if (nextMode === 'plain' && !sourceEncryption) {
                                                throw new Error(
                                                    'Account encryption material is unavailable for the E2EE-to-plaintext migration',
                                                );
                                            }
                                            const currentness =
                                                await fetchAccountEncryptionCurrentness(
                                                    credentials,
                                                );
                                            if (
                                                currentness.mode
                                                !== accountEncryptionMode
                                            ) {
                                                if (
                                                    currentness.mode === 'plain'
                                                    && !isTokenOnlyAuthCredentials(
                                                        credentials,
                                                    )
                                                ) {
                                                    const credentialReplacement =
                                                        await auth.loginWithCredentials({
                                                            token: credentialsToken,
                                                        });
                                                    if (
                                                        credentialReplacement.kind
                                                        !== 'completed'
                                                    ) {
                                                        throw new Error(
                                                            'Plain Account credentials could not be persisted',
                                                        );
                                                    }
                                                    publishAccountEncryptionPresentation(
                                                        presentationScope,
                                                        currentness.mode,
                                                    );
                                                    return;
                                                }
                                                publishAccountEncryptionPresentation(
                                                    presentationScope,
                                                    currentness.mode,
                                                );
                                                throw new Error(
                                                    'Account encryption mode changed while preparing the migration',
                                                );
                                            }
                                            const expectedSettingsVersion = storage.getState().settingsVersion ?? 0;
                                            const connectedServiceProfiles = profile.connectedServicesV2.flatMap((svc) =>
                                                svc.profiles.map((p) => ({
                                                    serviceId: svc.serviceId as any,
                                                    profileId: p.profileId,
                                                })),
                                            );
                                            const automations = Object.values(storage.getState().automations ?? {}).map((a: any) => ({
                                                id: a.id,
                                                templateVersion: a.templateVersion,
                                                templateCiphertext: a.templateCiphertext,
                                            }));
                                            const preparedE2eeKey =
                                                nextMode === 'e2ee'
                                                    ? await prepareAccountEncryptionMigrateToE2eeKey({
                                                        credentials,
                                                        expectedSigningKeyFingerprint:
                                                            currentness
                                                                .signingKeyFingerprint,
                                                        expectedContentKeyFingerprint:
                                                            currentness
                                                                .contentKeyFingerprint,
                                                    })
                                                    : null;
                                            const accountSecurity = await accountSecurityClient.read();
                                            const transitionPassword = accountSecurity.password.status === 'enrolled'
                                                ? await Modal.prompt(
                                                    t('settingsAccount.nativePassword.password'),
                                                    t('settingsAccount.nativePassword.passwordRequirements'),
                                                    { inputType: 'secure-text' },
                                                )
                                                : null;
                                            if (accountSecurity.password.status === 'enrolled' && transitionPassword === null) return;
                                            const transitionCredentialRevision = accountSecurity.password.status === 'enrolled'
                                                ? accountSecurity.password.revision
                                                : null;
                                            const transitionChallengeAudience = accountSecurity.password.status === 'enrolled'
                                                ? resolveHomeKeyChallengeExpectedAudience({
                                                    kind: 'saved_profile',
                                                    profileRef: activeServer.serverId,
                                                })
                                                : null;
                                            if (accountSecurity.password.status === 'enrolled' && transitionCredentialRevision === null) {
                                                throw new Error('Account password credential revision is unavailable');
                                            }
                                            if (accountSecurity.password.status === 'enrolled' && !transitionChallengeAudience) {
                                                throw new Error('Account password challenge audience is unavailable');
                                            }
                                            const transitionSecret = accountSecurity.password.status === 'enrolled'
                                                ? preparedE2eeKey?.seed ?? (() => {
                                                    if (!isLegacyAuthCredentials(credentials)) {
                                                        throw new Error('Account recovery material is unavailable for the password transition');
                                                    }
                                                    const decoded = decodeBase64(credentials.secret, 'base64url');
                                                    if (decoded.length !== 32) throw new Error('Account recovery material is invalid');
                                                    return decoded;
                                                })()
                                                : null;
                                            const targetE2eePasswordCredential = transitionPassword !== null && transitionSecret && nextMode === 'e2ee'
                                                ? await prepareAccountEncryptionModePasswordCredential(serverFetch, {
                                                    fromMode: 'plain', toMode: 'e2ee', password: transitionPassword,
                                                    accountId: profile.id,
                                                    expectedCredentialRevision: transitionCredentialRevision!,
                                                    normalizedNativeEmail: accountSecurity.nativeEmail,
                                                    secret: transitionSecret,
                                                    expectedAudience: transitionChallengeAudience!,
                                                })
                                                : null;
                                            const targetEncryption =
                                                nextMode === 'e2ee'
                                                    ? await createEncryptionFromAuthCredentials(
                                                        preparedE2eeKey!
                                                            .credentials,
                                                    )
                                                    : null;
                                            const [
                                                machineRows,
                                                todoRows,
                                                artifactList,
                                                sessionRows,
                                                reviewCommentsInventory,
                                                sessionOrganizationInventory,
                                            ] = await Promise.all([
                                                fetchMachineRows({
                                                    credentials,
                                                }),
                                                kvList(credentials, {
                                                    prefix: 'todo.',
                                                    limit: 1000,
                                                    retry: 'none',
                                                }).then(
                                                    (response) =>
                                                        response.items,
                                                ),
                                                fetchArtifacts(credentials, {
                                                    retry: 'none',
                                                }),
                                                fetchAccountEncryptionMigrationSessionInventory({
                                                    token: credentials.token,
                                                }),
                                                fetchReviewCommentAccountEncryptionMigrationInventory(),
                                                fetchSessionOrganizationAccountEncryptionMigrationInventory(),
                                            ]);
                                            const artifactRows =
                                                await runTasksWithLimit(
                                                    artifactList.map(
                                                        (artifact) =>
                                                            async () => {
                                                                const full =
                                                                    await fetchArtifact(
                                                                        credentials,
                                                                        artifact.id,
                                                                        {
                                                                            retry:
                                                                                'none',
                                                                        },
                                                                    );
                                                                if (
                                                                    typeof full.body
                                                                        !==
                                                                        'string'
                                                                    || typeof full.bodyVersion
                                                                        !==
                                                                        'number'
                                                                ) {
                                                                    throw new Error(
                                                                        `Artifact migration snapshot is incomplete (${artifact.id})`,
                                                                    );
                                                                }
                                                                return {
                                                                    id: full.id,
                                                                    header:
                                                                        full.header,
                                                                    headerVersion:
                                                                        full.headerVersion,
                                                                    body:
                                                                        full.body,
                                                                    bodyVersion:
                                                                        full.bodyVersion,
                                                                    dataEncryptionKey:
                                                                        full.dataEncryptionKey,
                                                                };
                                                            },
                                                    ),
                                                    4,
                                                );
                                            const storageDirectives =
                                                await buildAccountEncryptionMigrationStorageDirectives({
                                                    fromMode:
                                                        currentness.mode,
                                                    toMode: nextMode,
                                                    sourceEncryption:
                                                        nextMode === 'plain'
                                                            ? sourceEncryption
                                                            : null,
                                                    targetEncryption,
                                                    machines: machineRows,
                                                    todos: todoRows,
                                                    artifacts: artifactRows,
                                                    sessions: sessionRows,
                                                    reviewCommentsInventory,
                                                    sessionOrganizationInventory,
                                                    sessionSourceCredentials:
                                                        credentials,
                                                    sessionTargetCredentials:
                                                        preparedE2eeKey
                                                            ?.credentials
                                                        ?? null,
                                                });
                                            const sessionDraftScope = sessionDraftSyncEnabled
                                                ? getActiveServerAccountScope()
                                                : null;
                                            const sessionDrafts = sessionDraftScope
                                                ? listNewSessionDraftEncryptionMigrationCandidates(
                                                    sessionDraftScope,
                                                )
                                                : [];
                                            let request: AccountEncryptionMigrateRequest = nextMode === 'plain'
                                                ? await buildAccountEncryptionMigrateToPlainRequest({
                                                    credentials,
                                                    expectedAccountVersion:
                                                        currentness.version,
                                                    expectedSigningKeyFingerprint:
                                                        currentness
                                                            .signingKeyFingerprint,
                                                    expectedContentKeyFingerprint:
                                                        currentness
                                                            .contentKeyFingerprint,
                                                    storageDirectives,
                                                    expectedSettingsVersion,
                                                    settings: storage.getState().settings,
                                                    connectedServiceProfiles,
                                                    qualifiedConnectedAccounts:
                                                        profile.connectedAccountsV4,
                                                    automations,
                                                    sessionDrafts,
                                                    fetchConnectedServiceCredentialSealed: async ({ serviceId, profileId }) =>
                                                        await getConnectedServiceCredentialSealed(credentials, { serviceId, profileId }),
                                                    fetchQualifiedConnectedAccountCredential: async (ref) =>
                                                        await getQualifiedConnectedAccountCredentialV4(credentials, ref),
                                                    fetchQualifiedConnectedAccountConfiguration: async (ref) =>
                                                        await getQualifiedConnectedAccountConfigurationV4(credentials, ref),
                                                    decryptAutomationTemplateRaw: async (payloadCiphertext: string) =>
                                                        await sourceEncryption!.decryptAutomationTemplateRaw(payloadCiphertext),
                                                })
                                                : await buildAccountEncryptionMigrateToE2eeRequest({
                                                    credentials:
                                                        preparedE2eeKey!
                                                            .credentials,
                                                    accountId: profile.id,
                                                    expectedAccountVersion:
                                                        currentness.version,
                                                    expectedSigningKeyFingerprint:
                                                        currentness
                                                            .signingKeyFingerprint,
                                                    expectedContentKeyFingerprint:
                                                        currentness
                                                            .contentKeyFingerprint,
                                                    storageDirectives,
                                                    expectedSettingsVersion,
                                                    settings: storage.getState().settings,
                                                    connectedServiceProfiles,
                                                    qualifiedConnectedAccounts:
                                                        profile.connectedAccountsV4,
                                                    automations,
                                                    sessionDrafts,
                                                    keyProof:
                                                        preparedE2eeKey!
                                                            .keyProof,
                                                    ...(targetE2eePasswordCredential
                                                        ? { passwordCredential: targetE2eePasswordCredential }
                                                        : {}),
                                                    fetchConnectedServiceCredentialPlain: async ({ serviceId, profileId }) =>
                                                        await getConnectedServiceCredentialPlain(credentials, { serviceId, profileId }),
                                                    fetchQualifiedConnectedAccountCredential: async (ref) =>
                                                        await getQualifiedConnectedAccountCredentialV4(credentials, ref),
                                                    fetchQualifiedConnectedAccountConfiguration: async (ref) =>
                                                        await getQualifiedConnectedAccountConfigurationV4(credentials, ref),
                                                });
                                            if (transitionPassword !== null && transitionSecret && nextMode === 'plain') {
                                                const passwordCredential = await prepareAccountEncryptionModePasswordCredential(serverFetch, {
                                                    fromMode: 'e2ee', toMode: 'plain', password: transitionPassword,
                                                    accountId: profile.id,
                                                    expectedCredentialRevision: transitionCredentialRevision!,
                                                    normalizedNativeEmail: accountSecurity.nativeEmail,
                                                    secret: transitionSecret,
                                                    expectedAudience: transitionChallengeAudience!,
                                                    baseRequest: request,
                                                });
                                                request = AccountEncryptionMigrateRequestSchema.parse({ ...request, passwordCredential });
                                            }
                                            // A retained-key Plain Account with a password proves the
                                            // current password for this exact request (L02-R22); the
                                            // keyless first-key journey below obtains the same proof.
                                            if (transitionPassword !== null && nextMode === 'e2ee'
                                                && !preparedE2eeKey!.requiresExternalAuthProof) {
                                                const externalAuthProof = await requestAccountEncryptionFirstKeyPasswordProof({
                                                    request: serverFetch,
                                                    token: credentials.token,
                                                    password: transitionPassword,
                                                    requestDigest: createAccountEncryptionMigrateRequestBindingDigestV1({
                                                        request,
                                                        accountId: profile.id,
                                                        sourceMode: 'plain',
                                                    }),
                                                });
                                                request = AccountEncryptionMigrateRequestSchema.parse({ ...request, externalAuthProof });
                                            }

                                            const result =
                                                nextMode === 'e2ee'
                                                && preparedE2eeKey!
                                                    .requiresExternalAuthProof
                                                    ? await (async () => {
                                                        const externalAuth =
                                                            await startAccountEncryptionFirstKeyExternalAuth({
                                                                accountId:
                                                                    profile.id,
                                                                currentCredentials:
                                                                    credentials,
                                                                proposedCredentials:
                                                                    preparedE2eeKey!
                                                                        .credentials,
                                                                request,
                                                                linkedProviderIds:
                                                                    (
                                                                        profile
                                                                            .linkedProviders
                                                                        ?? []
                                                                    ).map(
                                                                        (
                                                                            provider,
                                                                        ) =>
                                                                            provider.id,
                                                                    ),
                                                                returnTo:
                                                                    '/settings/account/security',
                                                                target: {
                                                                    serverId: activeServer.serverId,
                                                                    serverUrl: activeServer.serverUrl,
                                                                },
                                                                ...(transitionPassword !== null
                                                                    ? { nativePassword: transitionPassword }
                                                                    : {}),
                                                            });
                                                        if (
                                                            externalAuth.kind
                                                            === 'oauth'
                                                        ) {
                                                            await openAccountEncryptionFirstKeyExternalAuthUrl(
                                                                externalAuth.url,
                                                            );
                                                            return null;
                                                        }
                                                        const resumed =
                                                            await resumeAccountEncryptionFirstKeyExternalAuth({
                                                            provider:
                                                                externalAuth
                                                                    .externalAuthProof
                                                                    .provider,
                                                            pending:
                                                                externalAuth
                                                                    .externalAuthProof
                                                                    .pending,
                                                            currentCredentials:
                                                                credentials,
                                                            persistCredentials:
                                                                auth.loginWithCredentials,
                                                        });
                                                        return resumed.migration;
                                                    })()
                                                    : await runAccountEncryptionModeMigration({
                                                        request,
                                                        migrate: async (migrationRequest) =>
                                                            await migrateAccountEncryptionMode(
                                                                credentials,
                                                                migrationRequest,
                                                            ),
                                                        activateTargetMode: () => {
                                                            sync.reconfigureSessionDraftRepositoryForAccountMode(
                                                                nextMode === 'e2ee'
                                                                    ? preparedE2eeKey!.credentials
                                                                    : credentials,
                                                                nextMode,
                                                            );
                                                        },
                                                        acknowledgeSessionDrafts: async (records) => {
                                                            if (!sessionDraftScope) {
                                                                throw new Error(
                                                                    'Session draft repository scope is unavailable',
                                                                );
                                                            }
                                                            await acknowledgeNewSessionDraftEncryptionMigration(
                                                                sessionDraftScope,
                                                                records,
                                                            );
                                                        },
                                                    });
                                            if (!result) return;
                                            if (
                                                nextMode === 'plain'
                                                && result.mode === 'plain'
                                            ) {
                                                const credentialReplacement =
                                                    await auth.loginWithCredentials({
                                                        token: credentials.token,
                                                    });
                                                if (
                                                    credentialReplacement.kind
                                                    !== 'completed'
                                                ) {
                                                    throw new Error(
                                                        'Plain Account credentials could not be persisted',
                                                    );
                                                }
                                            }
                                            publishAccountEncryptionPresentation(
                                                presentationScope,
                                                result.mode,
                                            );

                                        } catch (e) {
                                            if (e instanceof HappyError) {
                                                if (nextMode === 'e2ee' && e.status === 400) {
                                                    if (
                                                        e.code === AccountEncryptionMigrateInvalidParamsReasonSchema.enum.restore_required
                                                    ) {
                                                        await Modal.alertAsync(
                                                            t('settingsAccount.restoreRequiredTitle'),
                                                            t('settingsAccount.restoreRequiredBody'),
                                                            [
                                                                {
                                                                    text: t('navigation.restoreWithSecretKey'),
                                                                    onPress: () => router.push('/restore/manual'),
                                                                },
                                                                {
                                                                    text: t('connect.lostAccessConfirmButton'),
                                                                    style: 'destructive',
                                                                    onPress: () => router.push('/restore/lost-access'),
                                                                },
                                                            ],
                                                        );
                                                        return;
                                                    }
                                                    if (e.code === AccountEncryptionMigrateInvalidParamsReasonSchema.enum.key_proof_required) {
                                                        await Modal.alertAsync(t('common.error'), t('settingsAccount.secretKeyMissing'));
                                                        return;
                                                    }
                                                }
                                                await Modal.alertAsync(t('common.error'), e.message);
                                                return;
                                            }
                                            await Modal.alertAsync(t('common.error'), t('settingsAccount.encryptionUpdateFailed'));
                                            return;
                                        } finally {
                                            setAccountEncryptionModeSaving(false);
                                        }
                                    }}
                                />
                            }
                            showChevron={false}
                        />
                    </ItemGroup>
                )}

    </>);
});
