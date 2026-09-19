import React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { resolveHomeKeyChallengeExpectedAudience } from '@/auth/flows/resolveHomeAuthenticationTarget';
import { isLegacyAuthCredentials } from '@/auth/storage/tokenStorage';
import { decodeBase64 } from '@/encryption/base64';
import { PasswordField } from '@/components/account/auth/emailPassword/PasswordField';
import {
    createEmailPasswordDraft,
    describeEmailPasswordFailure,
    requiresAccountSecurityReconciliation,
    resolveEmailPasswordProblemMessage,
    validateEmailPasswordDraft,
    type EmailPasswordDraft,
    type EmailPasswordProblem,
} from '@/components/account/auth/emailPassword/emailPasswordFormModel';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Text, TextInput } from '@/components/ui/text/Text';
import { WelcomeActionCard } from '@/components/onboarding/preAuth/WelcomeActionCard';
import {
    WelcomeActionAdmissionContext,
    type WelcomeActionAdmission,
} from '@/components/onboarding/preAuth/WelcomeActionList';
import { Modal } from '@/modal';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { createActionApprovalContinuation } from '@/components/approvals/actionApprovalContinuation';
import {
    maskEmailForNativeAuthPreview,
    normalizeVerifiedEmail,
    type AccountSecurityGetResponseV1,
} from '@happier-dev/protocol';
import { serverFetch } from '@/sync/http/client';
import { captureActiveServerAccountScopeCurrentness } from '@/sync/domains/scope/activeServerAccountScope';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useProfile } from '@/sync/domains/state/storage';
import {
    prepareE2eeAccountPasswordChange,
    prepareE2eeAccountPasswordEnroll,
    prepareE2eeAccountPasswordRemove,
} from '@/sync/api/auth/accountSecurity';
import { t } from '@/text';
import { HappyError } from '@/utils/errors/errors';
import {
    clearAccountPasswordEnrollmentExternalAuthCustody,
    openAccountPasswordEnrollmentExternalAuthSession,
    readAccountPasswordEnrollmentExternalAuthProof,
    startAccountPasswordEnrollmentExternalAuth,
} from '@/sync/ops/account/accountEncryptionFirstKeyExternalAuth';

import {
    AccountSecurityActionApprovalPendingError,
    createAccountSecurityActionClient,
    type AccountSecurityActionClient,
} from './accountSecurityActionClient';
import { presentAccountRecoveryKeyEntry } from './presentAccountRecoveryKeyEntry';

type SectionState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'unavailable'; scopeKey: string; problem: EmailPasswordProblem }>
    | Readonly<{ kind: 'ready'; scopeKey: string; projection: AccountSecurityGetResponseV1 }>;

type OpenForm = 'none' | 'change_password' | 'remove_password' | 'change_email';
/**
 * The last completed password mutation, kept only so a finished change is
 * visible. Enrolled -> enrolled leaves every row identical, so without this the
 * only feedback for a multi-second KDF would be the form closing.
 */
type PasswordOutcome = 'set_up' | 'changed' | 'removed';
type PreparedPlainPasswordEnrollment = NonNullable<Awaited<ReturnType<
    typeof readAccountPasswordEnrollmentExternalAuthProof
>>>;
type PendingPlainPasswordEnrollmentOAuth = Readonly<{
    kind: 'oauth';
    provider: string;
    url: string;
    scopeKey: string;
    target: Readonly<{ serverId: string; serverUrl: string }>;
}>;

/**
 * A pending address is only ever echoed back masked. The mailbox itself is the
 * proof channel, and this row stays on screen while anyone can look at it, so it
 * reuses the same canonical preview masker the Home's verification preview uses.
 */
function describePendingVerification(address: string): string {
    const masked = maskEmailForNativeAuthPreview(address);
    return masked
        ? t('settingsAccount.nativePassword.verificationPending', { email: masked })
        : t('settingsAccount.nativePassword.checkYourEmail');
}

function resolveE2eePasswordExpectedAudience(serverId: string) {
    const audience = resolveHomeKeyChallengeExpectedAudience({
        kind: 'saved_profile',
        profileRef: serverId,
    });
    if (!audience) {
        throw new HappyError('Account password challenge audience is unavailable', false, {
            kind: 'auth', code: 'challenge_unavailable',
        });
    }
    return audience;
}

/**
 * The email and password rows of Account Security.
 *
 * It shows the one native sign-in email and the enrolment state of the password
 * credential. It never lists internal verified-mailbox evidence rows, hashes or
 * envelopes, and every mutation goes through the canonical Account Security
 * Actions with the credential revision the projection reported. E2EE proof
 * preparation is local, but its final mutation still crosses that same Action
 * front door.
 */
export const AccountEmailPasswordSection = React.memo(function AccountEmailPasswordSection(props: Readonly<{
    client?: AccountSecurityActionClient;
    verificationToken?: string | null;
    connectIntent?: boolean;
    /**
     * Publishes the one Account Security projection this section already reads
     * so the route owner can compose its own rows from it. A second reader would
     * be a second decision-maker for the same Account facts.
     */
    onProjection?: (projection: AccountSecurityGetResponseV1 | null) => void;
}>) {
    const auth = useAuth();
    const profile = useProfile();
    const activeServer = useActiveServerSnapshot();
    const { theme } = useUnistyles();
    const client = React.useMemo(() => props.client ?? createAccountSecurityActionClient(), [props.client]);
    const [state, setState] = React.useState<SectionState>({ kind: 'loading' });
    const [openForm, setOpenForm] = React.useState<OpenForm>(
        props.verificationToken || props.connectIntent ? 'change_password' : 'none',
    );
    const [draft, setDraft] = React.useState<EmailPasswordDraft>(() => createEmailPasswordDraft());
    const [problem, setProblem] = React.useState<EmailPasswordProblem | null>(null);
    const [outcome, setOutcome] = React.useState<PasswordOutcome | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [pendingEmail, setPendingEmail] = React.useState<string | null>(null);
    const [pendingEnrollment, setPendingEnrollment] = React.useState(false);
    const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);
    const [pendingPlainPasswordOAuth, setPendingPlainPasswordOAuth] =
        React.useState<PendingPlainPasswordEnrollmentOAuth | null>(null);
    const activeActionRef = React.useRef<Readonly<{ id: string; scopeKey: string }> | null>(null);
    const mountedRef = React.useRef(true);
    const operationAbortRef = React.useRef<AbortController | null>(null);
    const onProjectionRef = React.useRef(props.onProjection);
    const effectMayHaveBegunRef = React.useRef(false);
    /**
     * A recovery secret supplied by the person for this mounted ceremony only.
     * It is never written to storage and is wiped when the section retires or
     * the Account/Home scope changes.
     */
    const unlockedSecretRef = React.useRef<Uint8Array | null>(null);
    const passwordEnrollmentResumeRef = React.useRef<string | null>(null);
    const emailInputRef = React.useRef<{ focus(): void } | null>(null);
    const currentPasswordInputRef = React.useRef<{ focus(): void } | null>(null);
    const passwordInputRef = React.useRef<{ focus(): void } | null>(null);
    const confirmPasswordInputRef = React.useRef<{ focus(): void } | null>(null);
    const scopeKey = auth.credentials
        ? `${activeServer.serverId}\u0000${profile.id}`
        : null;
    const scopeKeyRef = React.useRef(scopeKey);
    const noopApprovalRefresh = React.useCallback(() => undefined, []);
    const {
        approvalPending,
        requestApproval,
    } = useActionApprovalContinuation({
        scopeKey: scopeKey ?? `unbound:${activeServer.serverId}`,
        serverId: activeServer.serverId,
        // Result-bearing Account Security continuations own their exact
        // completion callback below. A second blanket reader here would race
        // that owner and issue duplicate projection refreshes.
        onExecuted: noopApprovalRefresh,
    });

    // Declared before every consumer effect so the first published projection
    // already reaches the current route owner.
    React.useEffect(() => {
        onProjectionRef.current = props.onProjection;
    });

    React.useEffect(() => {
        // React StrictMode replays mount effects. Every setup must restore the
        // liveness fence after the replayed cleanup.
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            operationAbortRef.current?.abort();
            unlockedSecretRef.current?.fill(0);
            unlockedSecretRef.current = null;
            const expected = {
                accountId: profile.id,
                target: {
                    serverId: activeServer.serverId,
                    serverUrl: activeServer.serverUrl,
                },
            };
            queueMicrotask(() => {
                if (!mountedRef.current) {
                    clearAccountPasswordEnrollmentExternalAuthCustody(
                        expected,
                    );
                }
            });
        };
    }, [activeServer.serverId, activeServer.serverUrl, profile.id]);

    React.useEffect(() => {
        // The ref starts with the first render's scope, so only a real
        // Account/Home transition retires the section. This preserves a
        // purpose-bound verification token on first mount and is idempotent
        // under React StrictMode's effect replay.
        if (scopeKeyRef.current === scopeKey) return;
        clearAccountPasswordEnrollmentExternalAuthCustody();
        scopeKeyRef.current = scopeKey;
        operationAbortRef.current?.abort();
        operationAbortRef.current = null;
        passwordEnrollmentResumeRef.current = null;
        activeActionRef.current = null;
        unlockedSecretRef.current?.fill(0);
        unlockedSecretRef.current = null;
        // The previous Account's facts must not survive into the new scope.
        onProjectionRef.current?.(null);
        setState({ kind: 'loading' });
        setOpenForm(props.verificationToken || props.connectIntent ? 'change_password' : 'none');
        setDraft(createEmailPasswordDraft());
        setProblem(null);
        setOutcome(null);
        setBusy(false);
        setPendingEmail(null);
        setPendingEnrollment(false);
        setPendingActionId(null);
        setPendingPlainPasswordOAuth(null);
    }, [props.connectIntent, props.verificationToken, scopeKey]);

    React.useEffect(() => {
        if (!props.verificationToken && !props.connectIntent) return;
        setPendingPlainPasswordOAuth(null);
        clearAccountPasswordEnrollmentExternalAuthCustody({
            accountId: profile.id,
            target: {
                serverId: activeServer.serverId,
                serverUrl: activeServer.serverUrl,
            },
        });
        setProblem(null);
        setDraft(createEmailPasswordDraft());
        setOpenForm('change_password');
    }, [
        activeServer.serverId,
        activeServer.serverUrl,
        profile.id,
        props.connectIntent,
        props.verificationToken,
    ]);

    React.useEffect(() => {
        if (openForm === 'change_password') return;
        setPendingPlainPasswordOAuth(null);
        clearAccountPasswordEnrollmentExternalAuthCustody({
            accountId: profile.id,
            target: {
                serverId: activeServer.serverId,
                serverUrl: activeServer.serverUrl,
            },
        });
    }, [activeServer.serverId, activeServer.serverUrl, openForm, profile.id]);

    const reload = React.useCallback(async () => {
        if (!auth.credentials || !scopeKey) return;
        const requestedScopeKey = scopeKey;
        const accountLifetime = captureActiveServerAccountScopeCurrentness();
        const controller = new AbortController();
        const retirement = accountLifetime.onRetire(() => controller.abort());
        try {
            const projection = await client.read(controller.signal);
            if (!mountedRef.current || !accountLifetime.isCurrent() || scopeKeyRef.current !== requestedScopeKey) return;
            setState({ kind: 'ready', scopeKey: requestedScopeKey, projection });
            onProjectionRef.current?.(projection);
        } catch (cause) {
            if (!mountedRef.current || controller.signal.aborted || !accountLifetime.isCurrent()
                || scopeKeyRef.current !== requestedScopeKey) return;
            setState({ kind: 'unavailable', scopeKey: requestedScopeKey, problem: describeEmailPasswordFailure(cause) });
            onProjectionRef.current?.(null);
        } finally {
            retirement.dispose();
        }
    }, [auth.credentials, client, scopeKey]);

    React.useEffect(() => { void reload(); }, [reload]);

    const closeForm = React.useCallback(() => {
        setPendingPlainPasswordOAuth(null);
        setOpenForm('none');
        setDraft(createEmailPasswordDraft());
        setProblem(null);
    }, []);

    const completePlainPasswordEnrollment = React.useCallback(async () => {
        const requestedScopeKey = scopeKey;
        if (!requestedScopeKey || !mountedRef.current || scopeKeyRef.current !== requestedScopeKey) return;
        setProblem(null);
        closeForm();
        setOutcome('set_up');
        await reload();
    }, [closeForm, reload, scopeKey]);

    const reportPlainPasswordEnrollmentApprovalFailure = React.useCallback((code: string) => {
        if (!mountedRef.current || scopeKeyRef.current !== scopeKey) return;
        const nextProblem = describeEmailPasswordFailure(
            new HappyError('Password enrollment approval did not complete', false, {
                kind: 'auth',
                code,
            }),
            { homeLabel: activeServer.serverUrl },
        );
        setProblem(nextProblem);
        if (requiresAccountSecurityReconciliation(nextProblem)) void reload();
    }, [activeServer.serverUrl, reload, scopeKey]);

    /**
     * Marks the exact point after which the Home may already have applied a
     * mutation. Everything before it is a pre-effect refusal that keeps its own
     * typed cause.
     */
    const dispatchMutation = React.useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
        effectMayHaveBegunRef.current = true;
        return await operation();
    }, []);

    const submitPreparedPlainPasswordEnrollment = React.useCallback(async (
        prepared: PreparedPlainPasswordEnrollment,
        verificationToken: string,
        signal: AbortSignal,
    ): Promise<'completed' | 'approval_pending'> => {
        const target = {
            serverId: activeServer.serverId,
            serverUrl: activeServer.serverUrl,
        };
        const actionInput = {
            v: 1 as const,
            kind: 'plain' as const,
            email: prepared.normalizedNativeEmail,
            targetCredential: prepared.targetCredential,
            verificationToken,
            reauthentication: prepared.externalAuthProof,
        };
        try {
            await dispatchMutation(() => client.enrollPlainPassword(actionInput, signal));
        } catch (cause) {
            if (
                cause instanceof AccountSecurityActionApprovalPendingError
                && cause.actionId === 'account.password.enroll'
                && scopeKey
            ) {
                clearAccountPasswordEnrollmentExternalAuthCustody({
                    accountId: profile.id,
                    includingClaimed: true,
                    target,
                });
                requestApproval(createActionApprovalContinuation({
                    artifactId: cause.artifactId,
                    actionId: 'account.password.enroll',
                    scope: { serverId: activeServer.serverId, accountId: profile.id },
                    expectedInput: actionInput,
                    onSucceeded: completePlainPasswordEnrollment,
                    onFailed: reportPlainPasswordEnrollmentApprovalFailure,
                }));
                setProblem(describeEmailPasswordFailure(
                    new HappyError('Password enrollment is waiting for approval', false, {
                        kind: 'auth',
                        code: 'approval_pending',
                    }),
                ));
                return 'approval_pending';
            }
            if (
                cause instanceof HappyError
                && cause.code === 'reauthentication_required'
            ) {
                clearAccountPasswordEnrollmentExternalAuthCustody({
                    accountId: profile.id,
                    target,
                });
            }
            throw cause;
        }
        clearAccountPasswordEnrollmentExternalAuthCustody({
            accountId: profile.id,
            target,
        });
        return 'completed';
    }, [
        activeServer.serverId,
        activeServer.serverUrl,
        client,
        completePlainPasswordEnrollment,
        dispatchMutation,
        profile.id,
        reportPlainPasswordEnrollmentApprovalFailure,
        requestApproval,
        scopeKey,
    ]);

    const continuePlainPasswordEnrollmentOAuth = React.useCallback(async (
        pending: PendingPlainPasswordEnrollmentOAuth,
        verificationToken: string,
        signal: AbortSignal,
    ): Promise<boolean> => {
        const currentCredentials = auth.credentials;
        if (!currentCredentials || pending.scopeKey !== scopeKey) {
            setPendingPlainPasswordOAuth(null);
            clearAccountPasswordEnrollmentExternalAuthCustody();
            throw new HappyError(
                'Password enrollment proof is unavailable',
                false,
                {
                    kind: 'auth',
                    code: 'password-enrollment-external-auth-invalid',
                },
            );
        }
        let session: Awaited<ReturnType<
            typeof openAccountPasswordEnrollmentExternalAuthSession
        >>;
        try {
            session = await openAccountPasswordEnrollmentExternalAuthSession({
                kind: 'oauth',
                provider: pending.provider,
                url: pending.url,
                currentCredentials,
                target: pending.target,
            });
        } finally {
            if (mountedRef.current) setPendingPlainPasswordOAuth(null);
        }
        if (session.kind !== 'completed') return false;
        const reauthentication = await readAccountPasswordEnrollmentExternalAuthProof({
            accountId: profile.id,
            currentCredentials,
            target: pending.target,
        });
        if (!reauthentication) {
            throw new HappyError(
                'Password enrollment proof is unavailable',
                false,
                {
                    kind: 'auth',
                    code: 'password-enrollment-external-auth-invalid',
                },
            );
        }
        const submission = await submitPreparedPlainPasswordEnrollment(
            reauthentication,
            verificationToken,
            signal,
        );
        return submission === 'completed';
    }, [auth.credentials, profile.id, scopeKey, submitPreparedPlainPasswordEnrollment]);

    const problemMessage = problem ? resolveEmailPasswordProblemMessage(problem) : null;
    const outcomeMessage = outcome === 'set_up'
        ? t('settingsAccount.nativePassword.passwordSetUp')
        : outcome === 'changed'
            ? t('settingsAccount.nativePassword.passwordChanged')
            : outcome === 'removed'
                ? t('settingsAccount.nativePassword.passwordRemoved')
                : null;

    const focusProblem = React.useCallback((nextProblem: EmailPasswordProblem) => {
        requestAnimationFrame(() => {
            if (nextProblem.field === 'email') emailInputRef.current?.focus();
            if (nextProblem.field === 'currentPassword') currentPasswordInputRef.current?.focus();
            if (nextProblem.field === 'password') passwordInputRef.current?.focus();
            if (nextProblem.field === 'confirmPassword') confirmPasswordInputRef.current?.focus();
        });
    }, []);

    const runVisibleAction = React.useCallback(async (
        actionId: string,
        action: () => Promise<void> | void,
    ) => {
        if (!scopeKey || approvalPending || activeActionRef.current !== null) return;
        const activeAction = { id: actionId, scopeKey };
        activeActionRef.current = activeAction;
        setPendingActionId(actionId);
        try {
            await action();
        } finally {
            if (activeActionRef.current === activeAction && scopeKeyRef.current === scopeKey) {
                activeActionRef.current = null;
                setPendingActionId(null);
            }
        }
    }, [approvalPending, scopeKey]);
    const actionAdmission = React.useMemo<WelcomeActionAdmission>(() => ({
        pendingActionId: pendingActionId
            ?? (approvalPending ? 'settings-account-change-password-submit' : null),
        run: runVisibleAction,
    }), [approvalPending, pendingActionId, runVisibleAction]);

    const run = React.useCallback(async (
        operation: (signal: AbortSignal) => Promise<void>,
        credentialField?: 'password' | 'currentPassword',
    ) => {
        if (busy || approvalPending || !scopeKey) return;
        const requestedScopeKey = scopeKey;
        const controller = new AbortController();
        const accountLifetime = captureActiveServerAccountScopeCurrentness();
        const retirement = accountLifetime.onRetire(() => controller.abort());
        operationAbortRef.current?.abort();
        operationAbortRef.current = controller;
        effectMayHaveBegunRef.current = false;
        // A previous outcome is no longer the current truth once new work starts.
        setOutcome(null);
        setBusy(true);
        try {
            if (!accountLifetime.isCurrent() || scopeKeyRef.current !== requestedScopeKey) return;
            await operation(controller.signal);
            if (!accountLifetime.isCurrent() || scopeKeyRef.current !== requestedScopeKey) controller.abort();
        } catch (cause) {
            if (mountedRef.current && !controller.signal.aborted && scopeKeyRef.current === requestedScopeKey) {
                const nextProblem = describeEmailPasswordFailure(cause, {
                    // Named-Home copy ("disabled on X", "update X") is otherwise
                    // rendered with an empty placeholder from this surface.
                    homeLabel: activeServer.serverUrl,
                    ...(credentialField ? { credentialField } : {}),
                    ...(effectMayHaveBegunRef.current ? { effectMayHaveBegun: true } : {}),
                });
                setProblem(nextProblem);
                focusProblem(nextProblem);
                // The Home owns what actually happened. Re-read it rather than
                // leaving a stale revision or an unknown enrolment state on screen.
                if (requiresAccountSecurityReconciliation(nextProblem)) void reload();
            }
        } finally {
            retirement.dispose();
            if (operationAbortRef.current === controller && scopeKeyRef.current === requestedScopeKey) {
                operationAbortRef.current = null;
                if (mountedRef.current) setBusy(false);
            }
        }
    }, [activeServer.serverUrl, approvalPending, busy, focusProblem, reload, scopeKey]);

    React.useEffect(() => {
        const verificationToken = props.verificationToken;
        const currentCredentials = auth.credentials;
        if (
            !verificationToken
            || state.kind !== 'ready'
            || state.projection.encryptionMode !== 'plain'
            || state.projection.password.status !== 'not_enrolled'
            || !currentCredentials
            || !scopeKey
        ) return;
        const resumeKey = `${scopeKey}\u0000${verificationToken}`;
        if (passwordEnrollmentResumeRef.current === resumeKey) return;
        passwordEnrollmentResumeRef.current = resumeKey;
        void run(async (signal) => {
            const prepared =
                await readAccountPasswordEnrollmentExternalAuthProof({
                    accountId: profile.id,
                    currentCredentials,
                    target: {
                        serverId: activeServer.serverId,
                        serverUrl: activeServer.serverUrl,
                    },
                });
            if (!prepared) return;
            const submission = await submitPreparedPlainPasswordEnrollment(
                prepared,
                verificationToken,
                signal,
            );
            if (submission === 'approval_pending' || !mountedRef.current || signal.aborted) return;
            await completePlainPasswordEnrollment();
        });
    }, [
        activeServer.serverId,
        activeServer.serverUrl,
        auth.credentials,
        completePlainPasswordEnrollment,
        profile.id,
        props.verificationToken,
        run,
        scopeKey,
        state,
        submitPreparedPlainPasswordEnrollment,
    ]);

    const currentCredentials = auth.credentials;
    if (state.kind === 'loading' || !currentCredentials || !scopeKey
        || ('scopeKey' in state && state.scopeKey !== scopeKey)) {
        return null;
    }

    if (state.kind === 'unavailable') {
        return (
            <ItemGroup title={t('settingsAccount.nativePassword.securitySectionTitle')}>
                <Item
                    testID="settings-account-security-unavailable"
                    title={t('settingsAccount.nativePassword.securitySectionTitle')}
                    subtitle={resolveEmailPasswordProblemMessage(state.problem)}
                    icon={<Icon name="warning" size={24} color={theme.colors.status.error} />}
                    onPress={() => { setState({ kind: 'loading' }); void reload(); }}
                />
            </ItemGroup>
        );
    }

    const enrollmentVerificationToken = props.verificationToken;
    const projection = state.projection;
    const revision = projection.password.revision ?? 0;
    const enrolled = projection.password.status === 'enrolled';
    const e2ee = projection.encryptionMode === 'e2ee';
    const recoverySecret = isLegacyAuthCredentials(currentCredentials)
        ? currentCredentials.secret
        : null;

    /**
     * The recovery secret an E2EE password mutation must wrap and prove with.
     * A device that already holds it never asks; a data-key-only device asks for
     * the existing recovery key once per mounted ceremony (02.05 §5.5). The
     * caller owns the returned copy and wipes it.
     */
    const resolveE2eeSecretBytes = async (): Promise<Uint8Array | null> => {
        if (recoverySecret) return decodeBase64(recoverySecret, 'base64url');
        if (unlockedSecretRef.current) return unlockedSecretRef.current.slice();
        const requestedScopeKey = scopeKeyRef.current;
        const entered = await presentAccountRecoveryKeyEntry();
        if (!entered) return null;
        if (!mountedRef.current || scopeKeyRef.current !== requestedScopeKey) {
            entered.fill(0);
            return null;
        }
        unlockedSecretRef.current = entered;
        return entered.slice();
    };

    return (
        <WelcomeActionAdmissionContext.Provider value={actionAdmission}>
            <ItemGroup title={t('settingsAccount.nativePassword.securitySectionTitle')}>
                <Item
                    testID="settings-account-sign-in-email"
                    title={t('settingsAccount.nativePassword.signInEmail')}
                    subtitle={projection.nativeEmail ?? t('settingsAccount.nativePassword.signInEmailNotSet')}
                    detail={pendingEmail ? describePendingVerification(pendingEmail) : undefined}
                    icon={<Icon name="envelope" size={24} color={theme.colors.accent.blue} />}
                    onPress={() => {
                        setProblem(null);
                        setOutcome(null);
                        setPendingEmail(null);
                        setDraft(createEmailPasswordDraft());
                        setOpenForm(openForm === 'change_email' ? 'none' : 'change_email');
                    }}
                />
                <Item
                    testID="settings-account-password"
                    title={t('settingsAccount.nativePassword.password')}
                    subtitle={enrolled ? t('settingsAccount.nativePassword.passwordEnrolled') : t('settingsAccount.nativePassword.passwordNotEnrolled')}
                    icon={<Icon name="key" size={24} color={theme.colors.accent.orange} />}
                    onPress={() => {
                        setProblem(null);
                        setOutcome(null);
                        setDraft(createEmailPasswordDraft());
                        setOpenForm(openForm === 'change_password' ? 'none' : 'change_password');
                    }}
                />
                {enrolled ? (
                    <Item
                        testID="settings-account-password-remove"
                        title={t('settingsAccount.nativePassword.removePassword')}
                        subtitle={t('settingsAccount.nativePassword.removePasswordSubtitle')}
                        icon={<Icon name="trash" size={24} color={theme.colors.state.danger.foreground} />}
                        destructive
                        onPress={async () => {
                            const requestedScopeKey = scopeKey;
                            const confirmed = await Modal.confirm(
                                t('settingsAccount.nativePassword.removePassword'),
                                t('settingsAccount.nativePassword.removePasswordConsequence'),
                                { cancelText: t('common.cancel'), confirmText: t('settingsAccount.nativePassword.removePassword'), destructive: true },
                            );
                            if (!confirmed || !mountedRef.current || scopeKeyRef.current !== requestedScopeKey) return;
                            setProblem(null);
                            setOutcome(null);
                            setDraft(createEmailPasswordDraft());
                            setOpenForm('remove_password');
                        }}
                    />
                ) : null}
            </ItemGroup>

            {outcomeMessage ? (
                <View style={styles.notice}>
                    <Text
                        testID="settings-account-password-outcome"
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={[styles.noticeText, { color: theme.colors.state.success.foreground }]}
                    >{outcomeMessage}</Text>
                </View>
            ) : null}

            {pendingEmail ? (
                <View style={styles.form} testID="settings-account-pending-email-actions">
                    {problemMessage ? (
                        <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                            style={[styles.error, { color: theme.colors.status.error }]}>{problemMessage}</Text>
                    ) : null}
                    <WelcomeActionCard
                        testID="settings-account-change-email-resend"
                        title={t('settingsAccount.nativePassword.resend')}
                        iconName="paper-plane"
                        onPress={() => run(async (signal) => {
                            setProblem(null);
                            if (pendingEnrollment) {
                                await client.requestPasswordEnrollmentEmail({ email: pendingEmail }, signal);
                            } else {
                                await client.requestEmailChange({ email: pendingEmail }, signal);
                            }
                        })}
                    />
                    <WelcomeActionCard
                        testID="settings-account-change-email-cancel-pending"
                        title={t('common.cancel')}
                        iconName="x"
                        escape
                        onPress={() => {
                            setPendingEmail(null);
                            setPendingEnrollment(false);
                            setProblem(null);
                        }}
                    />
                </View>
            ) : null}

            {openForm === 'change_email' ? (
                <View style={styles.form} testID="settings-account-change-email-form">
                    <FieldItem label={t('settingsAccount.nativePassword.email')} supportingText={t('settingsAccount.nativePassword.changeEmailExplanation')}>
                        <TextInput
                            ref={emailInputRef as never}
                            testID="settings-account-change-email-input"
                            accessibilityLabel={t('settingsAccount.nativePassword.email')}
                            style={[styles.input, {
                                color: theme.colors.text.primary,
                                backgroundColor: theme.colors.surface.base,
                                borderColor: problem?.field === 'email' ? theme.colors.status.error : theme.colors.border.default,
                            }]}
                            value={draft.email}
                            onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            inputMode="email"
                            autoComplete="email"
                            textContentType="username"
                            editable={!busy && !approvalPending && !pendingPlainPasswordOAuth}
                        />
                    </FieldItem>
                    {problemMessage ? (
                        <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                            style={[styles.error, { color: theme.colors.status.error }]}>{problemMessage}</Text>
                    ) : null}
                    <WelcomeActionCard
                        testID="settings-account-change-email-submit"
                        title={t('settingsAccount.nativePassword.sendVerification')}
                        iconName="paper-plane"
                        primary
                        onPress={() => run(async (signal) => {
                            const email = draft.email.trim();
                            const normalized = normalizeVerifiedEmail(email);
                            if (!normalized) {
                                const nextProblem = {
                                    field: 'email',
                                    messageKey: email
                                        ? 'settingsAccount.nativePassword.emailInvalid'
                                        : 'settingsAccount.nativePassword.emailRequired',
                                } as const;
                                setProblem(nextProblem);
                                focusProblem(nextProblem);
                                return;
                            }
                            setProblem(null);
                            await client.requestEmailChange({ email: normalized.address }, signal);
                            if (!mountedRef.current || signal.aborted) return;
                            // Process-local only: the Home's one-time operation stays
                            // the authority and no unverified address is persisted.
                            setPendingEmail(normalized.address);
                            setPendingEnrollment(false);
                            closeForm();
                        })}
                    />
                    <WelcomeActionCard testID="settings-account-change-email-cancel" title={t('common.cancel')}
                        iconName="x" escape onPress={closeForm} />
                </View>
            ) : null}

            {openForm === 'change_password' || openForm === 'remove_password' ? (
                <View style={styles.form} testID={`settings-account-${openForm === 'change_password' ? 'change' : 'remove'}-password-form`}>
                    {enrolled && !e2ee ? (
                        <PasswordField
                            inputRef={currentPasswordInputRef}
                            testID="settings-account-current-password"
                            label={t('settingsAccount.nativePassword.currentPassword')}
                            value={draft.currentPassword}
                            onChangeText={(currentPassword) => setDraft((current) => ({ ...current, currentPassword }))}
                            autoComplete="current-password"
                            error={problem?.field === 'currentPassword' ? problemMessage : null}
                            editable={!busy && !approvalPending && !pendingPlainPasswordOAuth}
                            returnKeyType="next"
                        />
                    ) : null}
                    {!enrolled ? (
                        <FieldItem label={t('settingsAccount.nativePassword.email')}>
                            <TextInput
                                ref={emailInputRef as never}
                                testID="settings-account-password-enroll-email"
                                accessibilityLabel={t('settingsAccount.nativePassword.email')}
                                style={[styles.input, {
                                    color: theme.colors.text.primary,
                                    backgroundColor: theme.colors.surface.base,
                                    borderColor: problem?.field === 'email' ? theme.colors.status.error : theme.colors.border.default,
                                }]}
                                value={draft.email}
                                onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="email-address"
                                inputMode="email"
                                autoComplete="email"
                                textContentType="username"
                                editable={!busy && !approvalPending && !pendingPlainPasswordOAuth}
                            />
                            {problem?.field === 'email' && problemMessage ? (
                                <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                                    style={[styles.error, { color: theme.colors.status.error }]}>{problemMessage}</Text>
                            ) : null}
                        </FieldItem>
                    ) : null}
                    {openForm === 'change_password' ? (
                        <>
                            <PasswordField
                                inputRef={passwordInputRef}
                                testID="settings-account-new-password"
                                label={t('settingsAccount.nativePassword.newPassword')}
                                value={draft.password}
                                onChangeText={(password) => setDraft((current) => ({ ...current, password }))}
                                autoComplete="new-password"
                                supportingText={t('settingsAccount.nativePassword.passwordRequirements')}
                                error={problem?.field === 'password' ? problemMessage : null}
                                editable={!busy && !approvalPending && !pendingPlainPasswordOAuth}
                                returnKeyType="next"
                            />
                            <PasswordField
                                inputRef={confirmPasswordInputRef}
                                testID="settings-account-confirm-password"
                                label={t('settingsAccount.nativePassword.confirmPassword')}
                                value={draft.confirmPassword}
                                onChangeText={(confirmPassword) => setDraft((current) => ({ ...current, confirmPassword }))}
                                autoComplete="new-password"
                                error={problem?.field === 'confirmPassword' ? problemMessage : null}
                                editable={!busy && !approvalPending && !pendingPlainPasswordOAuth}
                                returnKeyType="go"
                            />
                        </>
                    ) : null}
                    {problem?.field === 'form' && problemMessage ? (
                        <Text testID="settings-account-password-form-error"
                            accessibilityRole="alert" accessibilityLiveRegion="polite"
                            style={[styles.error, { color: theme.colors.status.error }]}>{problemMessage}</Text>
                    ) : null}
                    <WelcomeActionCard
                        testID={pendingPlainPasswordOAuth
                            ? 'settings-account-password-enrollment-continue'
                            : openForm === 'change_password'
                                ? 'settings-account-change-password-submit'
                                : 'settings-account-remove-password-submit'}
                        title={pendingPlainPasswordOAuth
                            ? t('common.continue')
                            : openForm === 'change_password'
                            ? enrolled ? t('settingsAccount.nativePassword.changePassword') : t('settingsAccount.nativePassword.setNewPassword')
                            : t('settingsAccount.nativePassword.removePassword')}
                        iconName={openForm === 'change_password' ? 'check' : 'trash'}
                        primary
                        onPress={pendingPlainPasswordOAuth && enrollmentVerificationToken
                            ? () => run(async (signal) => {
                                const completed = await continuePlainPasswordEnrollmentOAuth(
                                    pendingPlainPasswordOAuth,
                                    enrollmentVerificationToken,
                                    signal,
                                );
                                if (!completed || !mountedRef.current || signal.aborted) return;
                                await completePlainPasswordEnrollment();
                            }, 'password')
                            : () => run(async (signal) => {
                            if (openForm === 'change_password') {
                                const validated = validateEmailPasswordDraft({
                                    purpose: enrolled ? 'change' : 'enroll',
                                    draft,
                                    requiresCurrentPassword: enrolled && !e2ee,
                                });
                                if (!validated.ok) {
                                    setProblem(validated.problem);
                                    focusProblem(validated.problem);
                                    return;
                                }
                                setProblem(null);
                                if (!enrolled && !e2ee) {
                                    if (!props.verificationToken) {
                                        await client.requestPasswordEnrollmentEmail({ email: validated.normalizedEmail }, signal);
                                        if (!mountedRef.current) return;
                                        setPendingEmail(validated.normalizedEmail);
                                        setPendingEnrollment(true);
                                        closeForm();
                                        return;
                                    }
                                    const target = {
                                        serverId: activeServer.serverId,
                                        serverUrl: activeServer.serverUrl,
                                    };
                                    let reauthentication = await readAccountPasswordEnrollmentExternalAuthProof({
                                        accountId: profile.id,
                                        currentCredentials,
                                        target,
                                    });
                                    if (!reauthentication) {
                                        const started = await startAccountPasswordEnrollmentExternalAuth({
                                            accountId: profile.id,
                                            currentCredentials,
                                            linkedProviderIds: (profile.linkedProviders ?? []).map((linked) => linked.id),
                                            normalizedNativeEmail: validated.normalizedEmail,
                                            newPassword: validated.password,
                                            signal,
                                            returnTo: `/settings/account/security?${new URLSearchParams({
                                                verificationToken: props.verificationToken,
                                                serverId: activeServer.serverId,
                                            }).toString()}`,
                                            target,
                                        });
                                        if (started.kind === 'oauth') {
                                            if (Platform.OS === 'web') {
                                                // Browser popup APIs require a direct user gesture. Preparation above
                                                // crosses network boundaries, so expose a second in-memory Continue
                                                // action instead of risking a blocked popup or persisting the credential.
                                                setPendingPlainPasswordOAuth({
                                                    ...started,
                                                    scopeKey,
                                                    target,
                                                });
                                                return;
                                            }
                                            // Native completes the provider session
                                            // inline, so this gesture owns settling
                                            // the surface exactly like web's Continue.
                                            const completed = await continuePlainPasswordEnrollmentOAuth(
                                                { ...started, scopeKey, target },
                                                props.verificationToken,
                                                signal,
                                            );
                                            if (!completed || !mountedRef.current || signal.aborted) return;
                                            await completePlainPasswordEnrollment();
                                            return;
                                        } else {
                                            reauthentication = {
                                                normalizedNativeEmail:
                                                    started.normalizedNativeEmail,
                                                targetCredential:
                                                    started.targetCredential,
                                                externalAuthProof: started.externalAuthProof,
                                            };
                                        }
                                    }
                                    const submission = await submitPreparedPlainPasswordEnrollment(
                                        reauthentication,
                                        props.verificationToken,
                                        signal,
                                    );
                                    if (submission === 'approval_pending') return;
                                    await completePlainPasswordEnrollment();
                                    return;
                                } else if (e2ee) {
                                    const enrollmentToken = props.verificationToken ?? null;
                                    if (!enrolled && !enrollmentToken) {
                                        // Prove the mailbox before asking for any recovery secret.
                                        await client.requestPasswordEnrollmentEmail({ email: validated.normalizedEmail }, signal);
                                        if (!mountedRef.current) return;
                                        setPendingEmail(validated.normalizedEmail);
                                        setPendingEnrollment(true);
                                        closeForm();
                                        return;
                                    }
                                    const expectedAudience =
                                        resolveE2eePasswordExpectedAudience(
                                            activeServer.serverId,
                                        );
                                    const secret = await resolveE2eeSecretBytes();
                                    if (!secret) return;
                                    try {
                                        if (enrolled) {
                                            const request = await prepareE2eeAccountPasswordChange(serverFetch, {
                                                expectedCredentialRevision: revision,
                                                normalizedNativeEmail: normalizeVerifiedEmail(projection.nativeEmail ?? '')?.normalizedEmail ?? null,
                                                secret,
                                                accountId: profile.id,
                                                expectedAudience,
                                                newPassword: validated.password,
                                                signal,
                                            });
                                            await dispatchMutation(() => client.changeE2eePassword(request, signal));
                                        } else {
                                            const request = await prepareE2eeAccountPasswordEnroll(serverFetch, {
                                                email: validated.email,
                                                normalizedNativeEmail: validated.normalizedEmail,
                                                secret,
                                                accountId: profile.id,
                                                expectedAudience,
                                                newPassword: validated.password,
                                                signal,
                                                ...(enrollmentToken ? { verificationToken: enrollmentToken } : {}),
                                            });
                                            await dispatchMutation(() => client.enrollE2eePassword(request, signal));
                                        }
                                    } finally {
                                        secret.fill(0);
                                    }
                                } else if (enrolled) {
                                    await dispatchMutation(() => client.changePlainPassword({
                                        expectedCredentialRevision: revision,
                                        currentPassword: draft.currentPassword,
                                        newPassword: validated.password,
                                    }, signal));
                                }
                            } else {
                                if (!e2ee && !draft.currentPassword) {
                                    const nextProblem = { field: 'currentPassword', messageKey: 'settingsAccount.nativePassword.currentPasswordRequired' } as const;
                                    setProblem(nextProblem);
                                    focusProblem(nextProblem);
                                    return;
                                }
                                setProblem(null);
                                if (e2ee) {
                                    const expectedAudience =
                                        resolveE2eePasswordExpectedAudience(
                                            activeServer.serverId,
                                        );
                                    const secret = await resolveE2eeSecretBytes();
                                    if (!secret) return;
                                    try {
                                        const request = await prepareE2eeAccountPasswordRemove(serverFetch, {
                                            expectedCredentialRevision: revision,
                                            normalizedNativeEmail: normalizeVerifiedEmail(projection.nativeEmail ?? '')?.normalizedEmail ?? null,
                                            secret,
                                            accountId: profile.id,
                                            expectedAudience,
                                        });
                                        await dispatchMutation(() => client.removeE2eePassword(request, signal));
                                    } finally {
                                        secret.fill(0);
                                    }
                                } else {
                                    await dispatchMutation(() => client.removePlainPassword({
                                        expectedCredentialRevision: revision,
                                        currentPassword: draft.currentPassword,
                                    }, signal));
                                }
                            }
                            if (!mountedRef.current || signal.aborted) return;
                            closeForm();
                            setOutcome(openForm === 'remove_password'
                                ? 'removed'
                                : enrolled ? 'changed' : 'set_up');
                            await reload();
                            }, openForm === 'remove_password' || (!e2ee && enrolled) ? 'currentPassword' : 'password')}
                    />
                    <WelcomeActionCard testID="settings-account-password-form-cancel" title={t('common.cancel')}
                        iconName="x" escape onPress={async () => {
                            if (!enrolled && !e2ee && props.verificationToken) {
                                clearAccountPasswordEnrollmentExternalAuthCustody({
                                    accountId: profile.id,
                                    includingClaimed: true,
                                    target: {
                                        serverId: activeServer.serverId,
                                        serverUrl: activeServer.serverUrl,
                                    },
                                });
                            }
                            closeForm();
                        }} />
                </View>
            ) : null}
        </WelcomeActionAdmissionContext.Provider>
    );
});

const styles = StyleSheet.create(() => ({
    form: { gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
    error: { fontSize: 13 },
    notice: { paddingHorizontal: 16, paddingBottom: 12 },
    noticeText: { fontSize: 13 },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: Platform.OS === 'android' ? 48 : 44,
    },
}));
