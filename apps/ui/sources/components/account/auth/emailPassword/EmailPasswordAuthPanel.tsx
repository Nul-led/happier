import * as React from 'react';
import { useRouter } from 'expo-router';
import type { NativeAccountAdmissionV1 } from '@happier-dev/protocol';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { EmailPasswordEntryAction } from '@/auth/capabilities/authMethodCapabilities';
import { resolveEmailPasswordProvisionModes } from '@/auth/capabilities/authMethodCapabilities';
import { loginEmailPassword, type EmailPasswordLoginTarget } from '@/auth/password/loginEmailPassword';
import {
    provisionEmailPasswordAccount,
} from '@/auth/password/provisionEmailPasswordAccount';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { WelcomeActionCard } from '@/components/onboarding/preAuth/WelcomeActionCard';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Text, TextInput } from '@/components/ui/text/Text';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import {
    rememberNativeInvitationEmailVerificationContinuation,
    requestNativeEmailVerification,
    requestNativePasswordReset,
} from '@/sync/api/auth/nativeAuthEmail';
import { t, tLoose } from '@/text';

import { PasswordField } from './PasswordField';
import {
    createEmailPasswordDraft,
    describeEmailPasswordFailure,
    resolveEmailPasswordProblemMessage,
    validateEmailPasswordDraft,
    type EmailPasswordDraft,
    type EmailPasswordProblem,
} from './emailPasswordFormModel';

/** Press feedback is immediate; delayed progress copy waits out a short flicker window. */
const DELAYED_PROGRESS_MS = 400;

export type EmailPasswordAuthOutcome = Readonly<{
    credentials: AuthCredentials;
    accountId?: string;
    teamId?: string | null;
    recoverySecret?: Uint8Array | null;
}>;

export type EmailPasswordAuthPanelProps = Readonly<{
    target: EmailPasswordLoginTarget;
    /** Portable Home identity carried into the recovery-key password replacement entry. */
    recoveryTarget: string;
    /** The exact entry action this controller was dispatched for. */
    action: EmailPasswordEntryAction;
    /** Home Account-mode policy for this action: keyed = E2EE, keyless = Plain. */
    mode: 'keyed' | 'keyless' | 'either';
    homeLabel?: string;
    /** A validated bounded admission bearer, when creation came from an invitation. */
    admission?: NativeAccountAdmissionV1;
    invitationEmailVerificationRequired?: boolean;
    initialEmail?: string;
    signal?: AbortSignal;
    onAuthenticated: (outcome: EmailPasswordAuthOutcome) => void | Promise<void>;
    /** Leaves this controller for the surrounding auth-entry surface. */
    onBack?: () => void;
}>;

type PanelView =
    | Readonly<{ kind: 'login' }>
    | Readonly<{ kind: 'provision' }>
    | Readonly<{ kind: 'connect' }>
    | Readonly<{ kind: 'forgot' }>
    | Readonly<{ kind: 'verification_sent'; email: string }>
    | Readonly<{ kind: 'reset_requested'; email: string }>;

function useDelayedProgress(busy: boolean): boolean {
    const [visible, setVisible] = React.useState(false);
    React.useEffect(() => {
        if (!busy) {
            setVisible(false);
            return;
        }
        const timer = setTimeout(() => setVisible(true), DELAYED_PROGRESS_MS);
        return () => clearTimeout(timer);
    }, [busy]);
    return visible;
}

/**
 * The one native email/password controller. `login`, `provision` and `connect`
 * each land here with their own view; none of them borrows another's form, and
 * an action this Home does not admit shows a truthful unavailable state rather
 * than a silently different journey.
 */
export const EmailPasswordAuthPanel = React.memo(function EmailPasswordAuthPanel(props: EmailPasswordAuthPanelProps) {
    const router = useRouter();
    const { theme } = useUnistyles();
    const [draft, setDraft] = React.useState<EmailPasswordDraft>(() => createEmailPasswordDraft(props.initialEmail ?? ''));
    const [view, setView] = React.useState<PanelView>(() => ({ kind: props.action }));
    const permittedModes = React.useMemo(() => resolveEmailPasswordProvisionModes(props.mode), [props.mode]);
    const [accountMode, setAccountMode] = React.useState<'plain' | 'e2ee'>(() => permittedModes[0]!);
    const [problem, setProblem] = React.useState<EmailPasswordProblem | null>(null);
    const [busy, setBusy] = React.useState(false);
    const showProgress = useDelayedProgress(busy);
    const mountedRef = React.useRef(true);
    const targetScope = `${props.target.serverIdentityId}|${props.target.canonicalServerUrl}|${props.target.endpointUrl}`;
    const targetScopeRef = React.useRef(targetScope);
    if (targetScopeRef.current !== targetScope) targetScopeRef.current = targetScope;
    const emailRef = React.useRef<{ focus: () => void } | null>(null);
    const passwordRef = React.useRef<{ focus: () => void } | null>(null);
    const confirmRef = React.useRef<{ focus: () => void } | null>(null);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    React.useEffect(() => {
        // A target replacement retires every in-flight result and clears
        // credentials typed for the prior Home. The next Home starts from its
        // own requested action rather than inheriting stale busy/error state.
        setBusy(false);
        setProblem(null);
        setDraft(createEmailPasswordDraft(props.initialEmail ?? ''));
        setView({ kind: props.action });
    }, [props.action, props.initialEmail, targetScope]);
    React.useEffect(() => {
        // A late permitted-mode narrowing must never leave a selection the Home
        // would refuse; it also must not silently reword the person's choice.
        if (!permittedModes.includes(accountMode)) setAccountMode(permittedModes[0]!);
    }, [accountMode, permittedModes]);

    const captureCurrentTarget = React.useCallback(() => {
        const expectedScope = targetScopeRef.current;
        return () => mountedRef.current
            && props.signal?.aborted !== true
            && targetScopeRef.current === expectedScope;
    }, [props.signal]);

    const focusProblem = React.useCallback((next: EmailPasswordProblem) => {
        setProblem(next);
        if (next.field === 'email') emailRef.current?.focus();
        else if (next.field === 'password') passwordRef.current?.focus();
        else if (next.field === 'confirmPassword') confirmRef.current?.focus();
    }, []);

    const problemMessage = React.useMemo(() => (
        problem ? resolveEmailPasswordProblemMessage(problem) : null
    ), [problem]);

    const run = React.useCallback(async (operation: () => Promise<void>) => {
        if (busy) return;
        const isCurrent = captureCurrentTarget();
        setProblem(null);
        setBusy(true);
        try {
            await operation();
        } catch (cause) {
            if (!isCurrent()) return;
            focusProblem(describeEmailPasswordFailure(cause, props.homeLabel ? { homeLabel: props.homeLabel } : {}));
        } finally {
            if (isCurrent()) setBusy(false);
        }
    }, [busy, captureCurrentTarget, focusProblem, props.homeLabel]);

    const publicRequest = React.useCallback(() => createServerFetchAtEndpoint({
        ...props.target,
        credentials: null,
        ...(props.signal ? { signal: props.signal } : {}),
    }), [props.signal, props.target]);

    const submitLogin = React.useCallback(() => run(async () => {
        const isCurrent = captureCurrentTarget();
        const validated = validateEmailPasswordDraft({ purpose: 'login', draft });
        if (!validated.ok) {
            focusProblem(validated.problem);
            return;
        }
        const credentials = await loginEmailPassword({
            target: props.target,
            email: validated.email,
            password: validated.password,
            ...(props.signal ? { signal: props.signal } : {}),
            isCurrent,
        });
        if (!isCurrent()) return;
        // Only the password is cleared: a recoverable failure keeps the address.
        setDraft((current) => ({ ...current, password: '' }));
        await props.onAuthenticated({ credentials });
    }), [captureCurrentTarget, draft, focusProblem, props, run]);

    const submitProvision = React.useCallback(() => run(async () => {
        const isCurrent = captureCurrentTarget();
        const validated = validateEmailPasswordDraft({ purpose: 'provision', draft });
        if (!validated.ok) {
            focusProblem(validated.problem);
            return;
        }
        const transferableInvitation = props.admission?.kind === 'team_invitation'
            && props.invitationEmailVerificationRequired === true
            && props.admission.emailVerificationToken === undefined;
        if (!props.admission || transferableInvitation) {
            // Creation needs proven mailbox control. Ask the Home to send the
            // link and say so plainly instead of hiding the journey.
            await requestNativeEmailVerification(publicRequest(), {
                email: validated.normalizedEmail,
                ...(transferableInvitation ? { admission: props.admission } : {}),
            });
            if (!isCurrent()) return;
            if (transferableInvitation) {
                rememberNativeInvitationEmailVerificationContinuation({
                    homeServerIdentityId: props.target.serverIdentityId,
                    normalizedEmail: validated.normalizedEmail,
                    admission: props.admission,
                });
            }
            setView({ kind: 'verification_sent', email: validated.email });
            return;
        }
        const created = await provisionEmailPasswordAccount({
            target: props.target,
            email: validated.email,
            password: validated.password,
            accountMode,
            admission: props.admission,
            ...(props.signal ? { signal: props.signal } : {}),
            isCurrent,
        });
        if (!isCurrent()) {
            // The Account exists, but this controller no longer owns the journey that
            // would disclose its recovery key. Nothing may hold those bytes after the
            // result is retired; the Account stays recoverable through Settings.
            if (created.recoverySecret instanceof Uint8Array) {
                created.recoverySecret.fill(0);
            }
            return;
        }
        setDraft((current) => ({ ...current, password: '', confirmPassword: '' }));
        await props.onAuthenticated(created);
    }), [accountMode, captureCurrentTarget, draft, focusProblem, props, publicRequest, run]);

    const submitResetRequest = React.useCallback(() => run(async () => {
        const isCurrent = captureCurrentTarget();
        const email = draft.email.trim();
        if (!email) {
            focusProblem({ field: 'email', messageKey: 'settingsAccount.nativePassword.emailRequired' });
            return;
        }
        await requestNativePasswordReset(publicRequest(), email);
        if (!isCurrent()) return;
        setView({ kind: 'reset_requested', email });
    }), [captureCurrentTarget, draft.email, focusProblem, publicRequest, run]);

    const emailField = (autoComplete: 'email' | 'username') => (
        <FieldItem label={t('settingsAccount.nativePassword.email')}>
            <TextInput
                ref={emailRef as never}
                testID="email-password-email"
                accessibilityLabel={t('settingsAccount.nativePassword.email')}
                aria-invalid={problem?.field === 'email'}
                style={[styles.input, {
                    color: theme.colors.text.primary,
                    backgroundColor: theme.colors.surface.base,
                    borderColor: problem?.field === 'email' ? theme.colors.status.error : theme.colors.border.default,
                }]}
                value={draft.email}
                onChangeText={(email) => setDraft((current) => ({ ...current, email }))}
                placeholder={t('settingsAccount.nativePassword.emailPlaceholder')}
                placeholderTextColor={theme.colors.text.secondary}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                keyboardType="email-address"
                inputMode="email"
                importantForAutofill="yes"
                autoComplete={autoComplete}
                textContentType="username"
                editable={!busy}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
            />
        </FieldItem>
    );

    const formProblem = problem?.field === 'form' && problemMessage ? (
        <Text
            testID="email-password-form-error"
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.formError, { color: theme.colors.status.error }]}
        >
            {problemMessage}
        </Text>
    ) : null;

    const progressNotice = showProgress ? (
        <Text testID="email-password-progress" accessibilityLiveRegion="polite" style={styles.hint}>
            {t('settingsAccount.nativePassword.working')}
        </Text>
    ) : null;

    const backAction = props.onBack ? (
        <WelcomeActionCard
            testID="email-password-back"
            title={t('common.back')}
            iconName="arrow-left"
            escape
            onPress={props.onBack}
        />
    ) : null;

    if (view.kind === 'verification_sent' || view.kind === 'reset_requested') {
        const sent = view;
        return (
            <View style={styles.root}>
                <Text style={styles.title}>{t('settingsAccount.nativePassword.checkYourEmail')}</Text>
                <Text testID="email-password-sent-detail" style={styles.hint}>
                    {sent.kind === 'verification_sent'
                        ? t('settingsAccount.nativePassword.verificationSent', { email: sent.email })
                        : t('settingsAccount.nativePassword.resetInstructionsSent', { email: sent.email })}
                </Text>
                {formProblem}
                <WelcomeActionCard
                    testID="email-password-resend"
                    title={t('settingsAccount.nativePassword.resend')}
                    iconName="paper-plane"
                    onPress={() => (sent.kind === 'verification_sent' ? submitProvision() : submitResetRequest())}
                />
                <WelcomeActionCard
                    testID="email-password-change-email"
                    title={t('settingsAccount.nativePassword.useDifferentEmail')}
                    iconName="pencil"
                    onPress={() => setView({ kind: sent.kind === 'verification_sent' ? 'provision' : 'forgot' })}
                />
                {backAction}
            </View>
        );
    }

    if (view.kind === 'connect') {
        // `connect` enrols this method on an Account that already exists. It is
        // reachable from Account Security, so say that instead of showing a
        // login form that would create the wrong impression.
        return (
            <View style={styles.root}>
                <Text style={styles.title}>{t('settingsAccount.nativePassword.connectTitle')}</Text>
                <Text testID="email-password-connect-detail" style={styles.hint}>
                    {t('settingsAccount.nativePassword.connectFromSecurity')}
                </Text>
                <WelcomeActionCard
                    testID="email-password-connect-sign-in"
                    title={t('settingsAccount.nativePassword.signInFirst')}
                    iconName="sign-in"
                    onPress={() => setView({ kind: 'login' })}
                />
                {backAction}
            </View>
        );
    }

    if (view.kind === 'forgot') {
        return (
            <View style={styles.root}>
                <Text style={styles.title}>{t('settingsAccount.nativePassword.forgotTitle')}</Text>
                <Text style={styles.hint}>{t('settingsAccount.nativePassword.forgotExplanation')}</Text>
                {emailField('email')}
                {formProblem}
                {progressNotice}
                <WelcomeActionCard
                    testID="email-password-request-reset"
                    title={t('settingsAccount.nativePassword.emailResetInstructions')}
                    iconName="envelope"
                    onPress={submitResetRequest}
                />
                <WelcomeActionCard
                    testID="email-password-use-recovery-key"
                    title={t('settingsAccount.nativePassword.useRecoveryKey')}
                    iconName="key"
                    onPress={() => router.push({
                        pathname: '/auth/password/recover',
                        params: { target: props.recoveryTarget },
                    })}
                />
                <WelcomeActionCard
                    testID="email-password-forgot-back"
                    title={t('common.back')}
                    iconName="arrow-left"
                    escape
                    onPress={() => setView({ kind: props.action })}
                />
            </View>
        );
    }

    const provisioning = view.kind === 'provision';

    return (
        <View style={styles.root}>
            <Text style={styles.title}>
                {provisioning ? t('settingsAccount.nativePassword.createTitle') : t('settingsAccount.nativePassword.title')}
            </Text>
            {props.homeLabel ? (
                <Text testID="email-password-home-label" style={styles.hint}>{props.homeLabel}</Text>
            ) : null}
            {emailField(provisioning ? 'email' : 'username')}
            {problem?.field === 'email' && problemMessage ? (
                <Text
                    testID="email-password-email-error"
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[styles.formError, { color: theme.colors.status.error }]}
                >
                    {problemMessage}
                </Text>
            ) : null}
            <PasswordField
                testID="email-password-password"
                inputRef={passwordRef}
                label={t('settingsAccount.nativePassword.password')}
                value={draft.password}
                onChangeText={(password) => setDraft((current) => ({ ...current, password }))}
                autoComplete={provisioning ? 'new-password' : 'current-password'}
                supportingText={provisioning ? t('settingsAccount.nativePassword.passwordRequirements') : undefined}
                error={problem?.field === 'password' ? problemMessage : null}
                editable={!busy}
                returnKeyType={provisioning ? 'next' : 'go'}
                onSubmitEditing={provisioning ? () => confirmRef.current?.focus() : submitLogin}
            />
            {provisioning ? (
                <PasswordField
                    testID="email-password-confirm"
                    inputRef={confirmRef}
                    label={t('settingsAccount.nativePassword.confirmPassword')}
                    value={draft.confirmPassword}
                    onChangeText={(confirmPassword) => setDraft((current) => ({ ...current, confirmPassword }))}
                    autoComplete="new-password"
                    error={problem?.field === 'confirmPassword' ? problemMessage : null}
                    editable={!busy}
                    returnKeyType="go"
                    onSubmitEditing={submitProvision}
                />
            ) : null}
            {provisioning && permittedModes.length > 1 ? (
                <FieldItem
                    label={t('settingsAccount.nativePassword.accountProtection')}
                    supportingText={accountMode === 'e2ee'
                        ? tLoose('settingsAccount.nativePassword.protectionE2eeDetail')
                        : t('settingsAccount.nativePassword.protectionPlainDetail')}
                >
                    <View style={styles.choices}>
                        {permittedModes.map((candidate) => (
                            <WelcomeActionCard
                                key={candidate}
                                testID={`email-password-protection-${candidate}`}
                                title={candidate === 'e2ee'
                                    ? tLoose('settingsAccount.nativePassword.protectionE2ee')
                                    : t('settingsAccount.nativePassword.protectionPlain')}
                                primary={accountMode === candidate}
                                iconName={candidate === 'e2ee' ? 'lock' : 'cloud'}
                                onPress={() => setAccountMode(candidate)}
                            />
                        ))}
                    </View>
                </FieldItem>
            ) : provisioning ? (
                <Text testID="email-password-protection-fixed" style={styles.hint}>
                    {permittedModes[0] === 'e2ee'
                        ? tLoose('settingsAccount.nativePassword.protectionE2eeDetail')
                        : t('settingsAccount.nativePassword.protectionPlainDetail')}
                </Text>
            ) : null}
            {formProblem}
            {progressNotice}
            <WelcomeActionCard
                testID={provisioning ? 'email-password-create' : 'email-password-submit'}
                title={provisioning ? t('settingsAccount.nativePassword.createAccount') : t('settingsAccount.nativePassword.signIn')}
                iconName="sign-in"
                primary
                onPress={provisioning ? submitProvision : submitLogin}
            />
            {!provisioning ? (
                <WelcomeActionCard
                    testID="email-password-forgot"
                    title={t('settingsAccount.nativePassword.forgotPassword')}
                    iconName="lifebuoy"
                    onPress={() => setView({ kind: 'forgot' })}
                />
            ) : null}
            {backAction}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: { width: '100%', gap: 12 },
    title: { fontSize: 20, fontWeight: '600', color: theme.colors.text.primary },
    hint: { fontSize: 13, color: theme.colors.text.secondary },
    formError: { fontSize: 13 },
    choices: { gap: 8 },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 44,
    },
}));
