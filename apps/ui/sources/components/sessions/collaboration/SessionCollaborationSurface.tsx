import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';

import { SessionAccessEditor } from '@/components/sessions/access/SessionAccessEditor';
import { useLiveSessionAccessEditorController } from '@/components/sessions/access/useLiveSessionAccessEditorController';
import { SessionResponsibilitySection } from '@/components/sessions/responsibility/SessionResponsibilitySection';
import { useSessionResponsibilityController } from '@/components/sessions/responsibility/useSessionResponsibilityController';
import { useSessionResponsibilityPickerHost } from '@/components/sessions/responsibility/useSessionResponsibilityPickerHost';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { RetainedPanelSurface } from '@/components/ui/panels/RetainedPanelSurface';
import { useSessionCollaborationAvailability } from '@/hooks/session/useSessionCollaborationAvailability';
import { serverAccountScopeKeySuffix, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';
import { SessionPresenceSection } from './SessionPresenceSection';
import { SessionPublicLinkSection } from './SessionPublicLinkSection';
import { SessionConversationsBody } from '@/components/sessions/conversations/SessionConversationsBody';
import { useSessionConversationsAvailability } from '@/components/sessions/conversations/useSessionConversationsAvailability';
import { restoreFocusToBestTarget } from '@/keyboard/focusReturn';
import { useExternalSessionSharingAvailability } from '@/components/sessions/external/sharing/useExternalSessionSharingAvailability';
import {
    consumeSessionCollaborationIntent,
    normalizeSessionCollaborationFocusTarget,
    readSessionCollaborationIntent,
    subscribeSessionCollaborationIntent,
    type SessionCollaborationFocusTarget,
} from './sessionCollaborationIntent';
import { useConsumeSessionCollaborationRouteFocus } from './useOpenSessionCollaboration';
import { useExactSessionSnapshot } from './useExactSessionSnapshot';
import { SessionExternalSharingAvailabilitySection } from './SessionExternalSharingAvailabilitySection';

const styles = StyleSheet.create({
    surface: { flex: 1, minHeight: 0, minWidth: 0 },
    // Only the access body flexes, so its SelectionList stays the one scroller
    // and the surrounding responsibility/presence/publication chrome stays fixed.
    body: { flex: 1, minHeight: 0, minWidth: 0 },
    modeRow: { paddingHorizontal: 12, paddingVertical: 8 },
});

/** Hosts supply geometry; each domain child retains its own state and failure boundary. */
export function SessionCollaborationSurface({ target }: Readonly<{ target: SessionAddress }>): React.ReactElement {
    const resolution = useServerCredentialAccountScopeResolution(target.serverId);
    const scope = resolution.kind === 'bound' ? resolution.scope : null;
    return (
        <View style={styles.surface} testID="session-collaboration-surface">
            {scope ? (
                <SessionCollaborationAccountContent
                    key={`${serverAccountScopeKeySuffix(scope)}:${sessionAddressKey({ serverId: scope.serverId, sessionId: target.sessionId })}`}
                    scope={scope}
                    sessionId={target.sessionId}
                />
            ) : resolution.kind === 'resolving' ? (
                <SurfaceStateCard
                    testID="session-collaboration-home-loading"
                    kind="loading"
                    title={t('session.collaboration.title')}
                    reason={t('common.loading')}
                    accessibilitySemantics="status"
                />
            ) : resolution.kind === 'unknown_home' ? (
                <SurfaceStateCard
                    testID="session-collaboration-unknown-home"
                    kind="unavailable"
                    title={t('teams.join.unknownHomeTitle')}
                />
            ) : (
                <SurfaceStateCard
                    testID="session-collaboration-signed-out"
                    kind="unavailable"
                    title={t('homeGovernance.signedOutTitle')}
                    reason={t('homeGovernance.signedOutBody')}
                />
            )}
        </View>
    );
}

function SessionCollaborationAccountContent(props: Readonly<{ scope: ServerAccountScope; sessionId: string }>) {
    const availability = useSessionCollaborationAvailability(props.scope.serverId);
    const conversationsEnabled = useSessionConversationsAvailability(props.scope.serverId);
    const target = React.useMemo(() => ({ serverId: props.scope.serverId, sessionId: props.sessionId }), [props.scope.serverId, props.sessionId]);
    const routeParams = useLocalSearchParams<{ collaborationFocus?: string | string[] }>();
    const routeFocus = normalizeSessionCollaborationFocusTarget(routeParams.collaborationFocus);
    const consumeRouteFocus = useConsumeSessionCollaborationRouteFocus();
    const pendingIntent = React.useSyncExternalStore(
        React.useCallback((listener) => subscribeSessionCollaborationIntent(target, listener), [target]),
        React.useCallback(() => readSessionCollaborationIntent(target), [target]),
        () => null,
    );
    const initialFocus = React.useRef(routeFocus ?? pendingIntent?.focusTarget ?? null).current;
    const [mode, setMode] = React.useState<'conversations' | 'access'>(() => (
        initialFocus === 'access' || initialFocus === 'publicLink' || !conversationsEnabled ? 'access' : 'conversations'
    ));
    const [visited, setVisited] = React.useState(() => ({ conversations: mode === 'conversations', access: mode === 'access' }));
    const responsibleAnchor = React.useRef<React.ElementRef<typeof View>>(null);
    const accessAnchor = React.useRef<React.ElementRef<typeof View>>(null);
    const publicLinkAnchor = React.useRef<React.ElementRef<typeof View>>(null);
    const appliedIntentId = React.useRef(0);
    const appliedRouteFocus = React.useRef<SessionCollaborationFocusTarget | null>(null);
    const requestedFocus = React.useRef<SessionCollaborationFocusTarget>(initialFocus ?? 'top');
    const userSelectedMode = React.useRef(false);
    const focusHandle = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const applyFocus = React.useCallback((focusTarget: SessionCollaborationFocusTarget) => {
        requestedFocus.current = focusTarget;
        userSelectedMode.current = false;
        const nextMode = focusTarget === 'access' || focusTarget === 'publicLink'
            ? 'access'
            : focusTarget === 'top'
                ? conversationsEnabled ? 'conversations' : 'access'
                : null;
        if (nextMode) {
            setMode(nextMode);
            setVisited((current) => current[nextMode] ? current : { ...current, [nextMode]: true });
        }
        // A superseding intent always cancels the pending move; an ordinary `top`
        // entry then schedules nothing, because only an explicit
        // Access/Responsible/Public Link request may take focus from the caller.
        if (focusHandle.current !== null) clearTimeout(focusHandle.current);
        if (focusTarget === 'top') return;
        focusHandle.current = setTimeout(() => {
            focusHandle.current = null;
            const anchor = focusTarget === 'responsible'
                ? responsibleAnchor.current
                : focusTarget === 'publicLink'
                    ? publicLinkAnchor.current
                    : accessAnchor.current;
            restoreFocusToBestTarget({ current: anchor });
        }, 0);
    }, [conversationsEnabled]);

    React.useEffect(() => () => {
        if (focusHandle.current !== null) clearTimeout(focusHandle.current);
        focusHandle.current = null;
    }, []);

    React.useEffect(() => {
        if (!pendingIntent || pendingIntent.intentId <= appliedIntentId.current) return;
        appliedIntentId.current = pendingIntent.intentId;
        const consumed = consumeSessionCollaborationIntent(target);
        if (!consumed) return;
        applyFocus(consumed.focusTarget);
    }, [applyFocus, pendingIntent, target]);

    React.useEffect(() => {
        if (!routeFocus) {
            // The canonical one-shot route mailbox has been consumed. Forget
            // only the previous handled value so a later caller may issue the
            // same exact focus request while this retained surface stays mounted.
            appliedRouteFocus.current = null;
            return;
        }
        if (routeFocus === appliedRouteFocus.current) return;
        appliedRouteFocus.current = routeFocus;
        applyFocus(routeFocus);
        // Consumed exactly like the in-process intent: the key requested this one
        // move, so it is cleared at the canonical navigation owner and cannot
        // re-apply itself on a later remount, Back, or revisit of this Session.
        consumeRouteFocus();
    }, [applyFocus, consumeRouteFocus, routeFocus]);

    React.useEffect(() => {
        if (!conversationsEnabled && mode === 'conversations') setMode('access');
        if (conversationsEnabled && requestedFocus.current === 'top' && !userSelectedMode.current && mode !== 'conversations') {
            setMode('conversations');
            setVisited((current) => current.conversations ? current : { ...current, conversations: true });
        }
    }, [conversationsEnabled, mode]);
    const selectMode = React.useCallback((nextMode: 'conversations' | 'access') => {
        userSelectedMode.current = true;
        setMode(nextMode);
        setVisited((current) => current[nextMode] ? current : { ...current, [nextMode]: true });
    }, []);
    // Responsibility's one controller and one responsive presentation owner are
    // created here, not in the row, because the compact host pushes its step in
    // place of this surface's body. A row-owned host could only ever open an
    // overlay above the surface it belongs to.
    const responsibilityController = useSessionResponsibilityController(props.sessionId, props.scope);
    const responsibilityPickerHost = useSessionResponsibilityPickerHost({
        sessionId: props.sessionId,
        scope: props.scope,
        actingAccountId: props.scope.accountId,
        controller: responsibilityController,
        editable: responsibilityController.availability === 'editable',
        // A Home that stops projecting responsibility, or a target that is back to
        // first load, no longer has a row to pick for: dismiss rather than leave a
        // step over a section that is not rendered.
        available: availability === 'full_collaboration'
            && (responsibilityController.availability === 'editable' || responsibilityController.availability === 'read_only'),
    });
    return (
        <View style={styles.surface}>
            {/*
              * The compact Responsibility step replaces this body instead of
              * floating above it, and the body stays mounted but inert so
              * Conversations/Access scroll, drafts and focus survive the step.
              */}
            <RetainedPanelSurface
                isActive={!responsibilityPickerHost.compactStepOpen}
                testID="session-collaboration-main-panel"
            >
                <View style={styles.surface}>
                    {availability === 'full_collaboration' ? (
                        <View ref={responsibleAnchor} tabIndex={-1} testID="session-collaboration-responsible-anchor">
                            <SessionResponsibilitySection
                                controller={responsibilityController}
                                pickerHost={responsibilityPickerHost}
                            />
                        </View>
                    ) : null}
                    <SessionPresenceSection serverId={props.scope.serverId} sessionId={props.sessionId} />
                    {conversationsEnabled ? <View style={styles.modeRow} testID="session-collaboration-modes">
                        <SegmentedTabBar
                            tabs={[
                                { id: 'conversations', label: t('session.collaboration.conversations') },
                                { id: 'access', label: t('session.collaboration.access') },
                            ]}
                            activeTabId={mode}
                            onSelectTab={selectMode}
                            testIDPrefix="session-collaboration-mode"
                            targetSize="platform"
                            accessibilityLabel={t('session.collaboration.modeLabel')}
                        />
                    </View> : null}
                    <View style={styles.body}>
                        {/*
                          * Retention only spans modes this Home still supports.
                          * A Home that withdraws Conversations also withdraws
                          * its selector, so a body kept from an earlier visit
                          * would stay mounted and subscribed with no way back
                          * to it — the dependent decision must fail closed here
                          * exactly as it does on first render.
                          */}
                        {(conversationsEnabled && (visited.conversations || mode === 'conversations')) ? (
                            <RetainedPanelSurface isActive={mode === 'conversations'} testID="session-collaboration-conversations-panel">
                                <SessionConversationsBody scope={props.scope} address={target} />
                            </RetainedPanelSurface>
                        ) : null}
                        {(visited.access || mode === 'access') ? (
                            <RetainedPanelSurface isActive={mode === 'access'} testID="session-collaboration-access-panel">
                                <SessionCollaborationAccessBody
                                    ref={accessAnchor}
                                    publicLinkAnchor={publicLinkAnchor}
                                    scope={props.scope}
                                    sessionId={props.sessionId}
                                    namedAccessAvailable={availability !== 'unavailable'}
                                />
                            </RetainedPanelSurface>
                        ) : null}
                    </View>
                </View>
            </RetainedPanelSurface>
            {responsibilityPickerHost.compactStep}
        </View>
    );
}

/** Named-access editing only exists where the Home supports it; publication is a separate child. */
function SessionNamedAccessEditor(props: Readonly<{ scope: ServerAccountScope; sessionId: string }>) {
    const controller = useLiveSessionAccessEditorController({ scope: props.scope, sessionId: props.sessionId });
    return <SessionAccessEditor {...controller} presentation="full" testID="session-access-editor:collaboration" />;
}

const SessionCollaborationAccessBody = React.forwardRef<React.ElementRef<typeof View>, Readonly<{
    scope: ServerAccountScope;
    sessionId: string;
    publicLinkAnchor: React.RefObject<React.ElementRef<typeof View> | null>;
    namedAccessAvailable: boolean;
}>>((props, ref) => {
    const snapshot = useExactSessionSnapshot(props.scope, props.sessionId);
    const session = snapshot.kind === 'ready' ? snapshot.session : null;
    const externalAvailability = useExternalSessionSharingAvailability({
        serverId: props.scope.serverId,
        sessionId: props.sessionId,
        session,
        accountScopeKey: serverAccountScopeKeySuffix(props.scope),
    });
    return (
        <View ref={ref} tabIndex={-1} style={styles.body} testID="session-collaboration-access-body">
            <SessionExternalSharingAvailabilitySection
                snapshot={snapshot}
                availability={snapshot.kind === 'ready' ? externalAvailability : null}
            />
            {props.namedAccessAvailable ? (
                <SessionNamedAccessEditor scope={props.scope} sessionId={props.sessionId} />
            ) : (
                <SurfaceStateCard
                    testID="session-collaboration-named-access-unavailable"
                    kind="unavailable"
                    title={t('session.collaboration.accessUnavailable')}
                    reason={t('session.collaboration.accessUnavailableReason')}
                />
            )}
            <View ref={props.publicLinkAnchor} tabIndex={-1} testID="session-collaboration-public-link-anchor">
                <SessionPublicLinkSection
                    scope={props.scope}
                    sessionId={props.sessionId}
                    session={session}
                    availability={externalAvailability}
                />
            </View>
        </View>
    );
});
SessionCollaborationAccessBody.displayName = 'SessionCollaborationAccessBody';
