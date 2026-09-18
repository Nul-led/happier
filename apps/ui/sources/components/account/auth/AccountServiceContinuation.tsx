import * as React from 'react';
import { View } from 'react-native';
import { SecretKeyEntryForm } from '@/components/account/restore/SecretKeyEntryForm';
import { PairingLinkEntryForm } from '@/components/account/restore/PairingLinkEntryForm';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { parseHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Modal } from '@/modal';
import { t } from '@/text';
import { completeAccountServicePostAuth, confirmAccountServiceHomeRelink, resumeAccountServicePostAuth, supplyAccountServiceHomeMaterial,
    type AccountPostAuthInput, type AccountPostAuthResult } from '@/sync/ops/accountDirectory/completeAccountServicePostAuth';
import { getPendingDirectoryHomeEnrollment, subscribePendingDirectoryHomeEnrollment, resumePendingDirectoryHomeEnrollment, cancelPendingDirectoryHomeEnrollment } from '@/sync/ops/accountDirectory/enrollDirectoryHome';
import { useAccountDirectoryActivePolling } from '@/sync/ops/accountDirectory/useAccountDirectoryActivePolling';
import { formatEnrollmentExpiry } from '@/auth/pairing/pairingPresentation';
import { resolveServerProfileForPortableIdentity } from '@/sync/domains/server/serverProfiles';
import { WelcomeActionAdmissionContext } from '@/components/onboarding/preAuth/WelcomeActionList';
import { describeAccountServiceFailure } from './accountServiceFailurePresentation';

const RestoreScanComputerQrView = React.lazy(async () => ({ default: (await import('@/components/account/restore/RestoreScanComputerQrView')).RestoreScanComputerQrView }));

export function AccountServiceContinuation(props: Readonly<{
    input: AccountPostAuthInput;
    result: AccountPostAuthResult;
    onResult: (result: AccountPostAuthResult, input?: AccountPostAuthInput) => void | Promise<void>;
    onBack: () => void;
    onReauthenticate?: (input: AccountPostAuthInput) => void | Promise<void>;
    onOpenHomeAuthentication?: (
        input: AccountPostAuthInput,
        homeServerIdentityId: string,
        previous: AccountPostAuthResult,
    ) => void | Promise<void>;
}>): React.ReactElement {
    const [recoveryView, setRecoveryView] = React.useState<'key' | 'scan' | 'paste'>('key');
    const [pairingLink, setPairingLink] = React.useState<string | null>(null);
    const admission = React.useContext(WelcomeActionAdmissionContext);
    const inFlight = React.useRef(false);
    const [busy, setBusy] = React.useState(false);
    const run = async (actionId: string, action: () => Promise<void> | void) => {
        if (inFlight.current || props.input.signal?.aborted) return;
        inFlight.current = true;
        setBusy(true);
        try { await admission.run(actionId, action); }
        finally { inFlight.current = false; setBusy(false); }
    };
    const pending = React.useSyncExternalStore(subscribePendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment, getPendingDirectoryHomeEnrollment);
    const ownsPending = pending?.input.session === props.input.session
        && JSON.stringify(pending.input.intent) === JSON.stringify(props.input.intent);
    useAccountDirectoryActivePolling(async () => {
        if (!ownsPending) return 'completed';
        const result = await resumePendingDirectoryHomeEnrollment();
        if (result) await props.onResult(result);
        return result?.kind === 'failure' && result.recovery === 'retry_stage' ? 'backoff' : 'completed';
    }, ownsPending);

    const back = async () => {
        if (ownsPending && pending) await cancelPendingDirectoryHomeEnrollment(pending);
        props.onBack();
    };
    const retry = async () => { await props.onResult(await resumeAccountServicePostAuth(props.input, props.result)); };
    const material = props.result.kind === 'home_material_required' ? props.result : null;
    const failure = props.result.kind === 'failure' ? props.result : null;
    const failurePresentation = failure ? describeAccountServiceFailure(failure.code) : null;
    const target = material?.homeServerIdentityId ?? failure?.targetHomeServerIdentityId
        ?? (props.result.kind === 'explicit_target_not_linked' || props.result.kind === 'approval_required' ? props.result.homeServerIdentityId : undefined);
    const targetProfile = target ? resolveServerProfileForPortableIdentity(target) : null;
    const verifiedAccountServiceName = props.input.service.snapshot.features.accountServicePresentation?.displayName?.trim() || undefined;
    const homeName = props.input.session.snapshot.homes.find((home) => home.homeServerIdentityId === target)?.label
        ?? (targetProfile?.kind === 'resolved' ? targetProfile.profile.name : t('common.home'));
    const paired = material ? async (value: Parameters<typeof supplyAccountServiceHomeMaterial>[2]) => {
        const result = await supplyAccountServiceHomeMaterial(props.input, material, value);
        setRecoveryView('key');
        setPairingLink(null);
        await props.onResult(result);
    } : undefined;

    if (recoveryView === 'paste') return <PairingLinkEntryForm onBack={() => setRecoveryView('scan')} onSubmit={async (link) => {
        if (!parseHomeQrInviteDeepLink(link, target ? { homeServerIdentityId: target, direction: 'trusted_home_displays' } : undefined)) return false;
        setPairingLink(link);
        setRecoveryView('scan');
        return true;
    }} />;
    if (recoveryView === 'scan') return <React.Suspense fallback={<ActivitySpinner />}><RestoreScanComputerQrView embedded
        entryIntent="add_home"
        expectedHomeServerIdentityId={target} initialPairingLink={pairingLink}
        onCredentials={paired} onBack={() => { setPairingLink(null); setRecoveryView('key'); }}
        onAuthenticated={material ? undefined : async (authenticatedHome) => {
            const result = await resumeAccountServicePostAuth(props.input, props.result, authenticatedHome);
            setRecoveryView('key');
            setPairingLink(null);
            await props.onResult(result);
        }}
        onOpenSecretKeyLogin={material ? () => setRecoveryView('key') : undefined}
        onOpenPairingLinkEntry={() => setRecoveryView('paste')} /></React.Suspense>;
    if (material) return <View>
        <SecretKeyEntryForm description={t('welcome.accountKeyDescription', { service: homeName })}
            submitTitle={t('welcome.accountKeySubmit')} onBack={() => { void back(); }}
            onSubmit={async ({ secret }) => {
                const result = await supplyAccountServiceHomeMaterial(props.input, material, secret);
                await props.onResult(result);
                return { kind: result.kind === 'home_material_required' ? 'invalid_key' : result.kind === 'failure' ? 'failed' : 'completed' };
            }} />
        <RoundButton title={t('connect.scanExistingHomeQrTitle')} onPress={() => setRecoveryView('scan')} />
    </View>;
    if (props.result.kind === 'choose_home') return <View>
        {props.result.homes.map((home) => <RoundButton key={home.homeServerIdentityId} title={home.label}
            testID={`account-service-choose-home-${home.homeServerIdentityId}`}
            disabled={busy || admission.pendingActionId !== null}
            action={async () => await run(home.homeServerIdentityId, async () => {
                const input: AccountPostAuthInput = { ...props.input,
                    intent: { kind: 'enter', target: { kind: 'explicit', homeServerIdentityId: home.homeServerIdentityId } } };
                await props.onResult(await completeAccountServicePostAuth(input), input);
            })} />)}
        <RoundButton title={t('common.back')} onPress={back} />
    </View>;
    const expired = failure?.code.source === 'home' && failure.code.code === 'expired';
    const canRetry = failure?.recovery === 'retry_stage';
    const noHomes = props.result.kind === 'account_connected_no_homes' || props.result.kind === 'explicit_target_not_linked';
    const successful = props.result.kind === 'account_connected' || props.result.kind === 'home_entered'
        || props.result.kind === 'home_enrolled' || props.result.kind === 'home_linked';
    const relink = async () => {
        const confirmed = await Modal.confirm(
            t('settingsAccount.accountServiceRelinkConfirmTitle', { accountService: verifiedAccountServiceName }),
            t('settingsAccount.accountServiceRelinkConfirmBody', { accountService: verifiedAccountServiceName }),
            { confirmText: t('common.continue'), cancelText: t('common.cancel') });
        if (confirmed) await props.onResult(await confirmAccountServiceHomeRelink(props.input));
    };
    return <View><SurfaceStateCard testID={`account-service-continuation-${props.result.kind}`}
        kind={failure ? 'error' : 'warning'}
        title={props.result.kind === 'approval_required' ? t('settingsAccount.accountServiceOAuth.stages.waitingApproval')
            : successful ? t('settingsAccount.accountServiceHomeConnected')
                : noHomes ? t('settingsAccount.accountServiceOAuth.stages.accountServiceConnected')
                    : failurePresentation ? failurePresentation.title : t('common.error')}
        reason={props.result.kind === 'approval_required' ? `${homeName} · ${formatEnrollmentExpiry(props.result.expiresAtMs)}`
            : failure?.recovery === 'reauthenticate_account' ? t('settingsAccount.accountServiceDiscoveryUnavailableDescription')
                : failure?.recovery === 'use_home_auth' ? t('connect.scanExistingHomeQrTitle')
                    : failurePresentation ? failurePresentation.body
                        : t('settingsAccount.accountServiceOAuth.errors.homeEnrollment.body')}
        accessibilitySemantics={failure ? 'alert' : 'status'}
        action={canRetry ? { label: t('common.retry'), onPress: retry }
            : failure?.recovery === 'reauthenticate_account' && props.onReauthenticate
                ? { label: t('common.continue'), onPress: () => run('reauthenticate', () => props.onReauthenticate!(props.input)) }
            : expired ? { label: t('connect.startAgain'), onPress: async () => { await props.onResult(await completeAccountServicePostAuth(props.input)); } }
                : failure?.recovery === 'relink_home' ? { label: t('settingsAccount.accountServiceLinkThisHome'), onPress: relink }
                    : failure?.recovery === 'use_home_auth' ? { label: t('connect.scanExistingHomeQrTitle'), onPress: () => setRecoveryView('scan') }
                        : { label: props.result.kind === 'approval_required' ? t('approvals.stopWaiting') : t('common.back'), onPress: back }} />
        {noHomes ? <View>
            <RoundButton title={t('common.refresh')} onPress={async () => { await props.onResult(await completeAccountServicePostAuth(props.input)); }} />
            <RoundButton title={t('connect.scanExistingHomeQrTitle')} onPress={() => setRecoveryView('scan')} />
        </View> : null}
        {target && props.onOpenHomeAuthentication && (failure?.recovery === 'use_home_auth' || props.result.kind === 'explicit_target_not_linked') ? (
            <RoundButton testID="account-service-direct-home-auth" title={t('common.continue')}
                disabled={busy} action={async () => await run('direct-home-auth', () => props.onOpenHomeAuthentication!(props.input, target, props.result))} />
        ) : null}
    </View>;
}
