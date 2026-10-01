import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useMountedSessionBoardController } from '@/components/sessions/board/SessionBoardControllerProvider';
import { useSessionCompanionController } from '@/components/sessions/companion/state/useSessionCompanionController';
import {
    buildSessionPresentationNoticeKeyPrefix,
    showSessionBoardItemInCompanion,
} from '@/components/sessions/companion/presentation/sessionCompanionPresentationAdapter';
import {
    useSessionCompanionRevealPort,
    type SessionCompanionRevealPort,
} from '@/components/sessions/companion/presentation/SessionCompanionRevealPort';
import { publishPresentationNotice } from '@/components/sessions/presentation/presentationNotices';
import { resolveSessionBoardItemTitle } from '@/components/sessions/board/sessionBoardItemPresentation';
import { SessionWidgetHost } from '@/components/sessions/board/SessionWidgetHost';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import type { ToolCall } from "@happier-dev/session-core/messages";
import { resolveSessionBoardReferenceProjection } from '@/sync/domains/session/board';
import { resolveSessionBoardExecutableCurrentness } from '@/sync/domains/session/board';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';

import {
    resolveTranscriptSessionBoardItemReference,
    type TranscriptSessionBoardItemReference,
} from './transcriptSessionBoardItemReference';

/**
 * The transcript's inline Board result — the last mile of Composer -> Agent
 * Action -> item -> inline result.
 *
 * It is a REFERENCE, not a placement. It mounts the one durable
 * `SessionWidgetHost` with `host='inlineTranscript'`, reading the exact-Session
 * Board the shell already observes, so there is no second Board fetch, cache,
 * renderer registry, transcript message type or persisted inline placement
 * anywhere in it. Everything visible — the title, provenance, the typed
 * loading/locked/malformed/missing/removed/unavailable cards and whether the item
 * runs here — comes from the Board's canonical owners.
 *
 * Executability is the shell's answer, never this row's: the shell publishes its
 * derived primary placement and this host passes it through. The Session shell's
 * visibility owner does not publish `inlineTranscript` as a candidate, so today an
 * executable source is always an inert preview here and a declarative document
 * renders live with no Action dispatch bound. If that shell ever does publish
 * this placement, the same pass-through turns it executable with no change here.
 */

const INLINE_HEIGHT_BOUNDS = Object.freeze({ min: 72, max: 320 });

const stylesheet = StyleSheet.create(() => ({
    root: { gap: 8, paddingTop: 8 },
    actions: { flexDirection: 'row', flexWrap: 'wrap' },
}));

export const SessionBoardActionResultReference = React.memo(function SessionBoardActionResultReference(
    props: Readonly<{
        tool: ToolCall;
        sessionId?: string;
        /** The row's captured Home. Absent means no reference; never an ambient Home. */
        serverId?: string | null;
    }>,
): React.ReactElement | null {
    const address = React.useMemo(
        () => normalizeSessionAddress(props.serverId ?? null, props.sessionId ?? null),
        [props.serverId, props.sessionId],
    );
    const reference = React.useMemo(() => resolveTranscriptSessionBoardItemReference({
        toolName: props.tool.name,
        state: props.tool.state,
        input: props.tool.input,
        result: props.tool.result,
        address,
    }), [address, props.tool.input, props.tool.name, props.tool.result, props.tool.state]);

    // Only a row that truthfully acknowledged a Board item subscribes to anything.
    if (!reference) return null;
    return <MountedSessionBoardReference reference={reference} />;
});

function MountedSessionBoardReference(props: Readonly<{
    reference: TranscriptSessionBoardItemReference;
}>): React.ReactElement | null {
    const styles = stylesheet;
    const { address, itemId } = props.reference;
    // Exact-address: a mounted controller for a different Home or Session answers
    // `null`, so the same local Session id on two Homes can never cross here.
    const mounted = useMountedSessionBoardController(address);
    const companionReveal = useSessionCompanionRevealPort(address);

    const pluginRuntime = mounted?.pluginRuntime;
    const callerHostedHtmlRuntime = mounted?.callerHostedHtmlRuntime ?? null;
    const resolveSourceAvailability = mounted?.controller.resolveSourceAvailability;
    const binding = mounted?.binding ?? null;
    const item = React.useMemo(
        () => (binding?.status === 'ready'
            ? resolveSessionBoardReferenceProjection(binding.snapshot, itemId)
            : null),
        [binding, itemId],
    );

    // No Board owner for this exact Session on this client: there is nothing to
    // mirror and nowhere to open. A transcript row is not the place to explain it.
    if (!mounted || !binding) return null;

    if (binding.status === 'unavailable') {
        // The Board feature being off, or an address this client cannot form, is
        // the absence of a Board rather than a broken item. Everything else —
        // revoked access, an unreachable Home, a refused read — is a truthful
        // state the person should see beside the Agent's claim.
        if (binding.reason === 'board_feature_disabled' || binding.reason === 'invalid_address') return null;
        const retryable = binding.reason === 'offline'
            || binding.reason === 'server_error'
            || binding.reason === 'invalid_response';
        return (
            <View style={styles.root} testID={`transcript-board-item-${itemId}`}>
                <SurfaceStateCard
                    testID={`transcript-board-item-${itemId}-unavailable`}
                    kind="unavailable"
                    title={t('sessionBoard.board.unavailable.title')}
                    reason={t('sessionBoard.board.unavailable.reason')}
                    diagnosticCode={binding.reason}
                    accessibilitySemantics="status"
                    {...(retryable && binding.refresh
                        ? { action: { label: t('common.retry'), onPress: binding.refresh } }
                        : {})}
                />
            </View>
        );
    }

    if (!item) return null;
    const title = resolveSessionBoardItemTitle(item.state);

    return (
        <View style={styles.root} testID={`transcript-board-item-${itemId}`}>
            {companionReveal ? (
                <MountedInlineBoardWidget
                    address={address}
                    itemId={itemId}
                    revealPort={companionReveal}
                    addAvailable={binding.snapshot.reachability === 'reachable'}
                    widgetProps={{
                        sessionId: address.sessionId,
                        item,
                        host: 'inlineTranscript',
                        primaryHost: mounted.resolvePrimaryHost(itemId),
                        density: 'compact',
                        canEdit: false,
                        executableCurrentness: resolveSessionBoardExecutableCurrentness(
                            binding.snapshot,
                            item,
                            pluginRuntime,
                        ),
                        heightBounds: INLINE_HEIGHT_BOUNDS,
                        resolveSourceAvailability,
                        ...(pluginRuntime ? { pluginRuntime } : {}),
                        ...(callerHostedHtmlRuntime ? { callerHostedHtmlRuntime } : {}),
                        testID: `transcript-board-widget-${itemId}`,
                    }}
                />
            ) : (
                <SessionWidgetHost
                    sessionId={address.sessionId}
                    item={item}
                    host="inlineTranscript"
                    primaryHost={mounted.resolvePrimaryHost(itemId)}
                    density="compact"
                    canEdit={false}
                    executableCurrentness={resolveSessionBoardExecutableCurrentness(
                        binding.snapshot,
                        item,
                        pluginRuntime,
                    )}
                    heightBounds={INLINE_HEIGHT_BOUNDS}
                    resolveSourceAvailability={resolveSourceAvailability}
                    {...(pluginRuntime ? { pluginRuntime } : {})}
                    {...(callerHostedHtmlRuntime ? { callerHostedHtmlRuntime } : {})}
                    testID={`transcript-board-widget-${itemId}`}
                />
            )}
            {companionReveal ? (
                <View style={styles.actions}>
                    <RoundButton
                        size="small"
                        display="inverted"
                        testID={`transcript-board-item-${itemId}-open`}
                        title={t('sessionBoard.inline.openBoard')}
                        accessibilityLabel={t('sessionBoard.inline.openBoardA11y', { title })}
                        onPress={() => companionReveal.revealBoardItem(itemId)}
                    />
                </View>
            ) : null}
        </View>
    );
}

function MountedInlineBoardWidget(props: Readonly<{
    address: TranscriptSessionBoardItemReference['address'];
    itemId: string;
    revealPort: SessionCompanionRevealPort;
    addAvailable: boolean;
    widgetProps: React.ComponentProps<typeof SessionWidgetHost>;
}>): React.ReactElement {
    const companion = useSessionCompanionController({
        sessionId: props.address.sessionId,
        serverId: props.address.serverId,
        openFullSurface: props.revealPort.openFullSurface,
    });
    const noticeKeyPrefix = React.useMemo(
        () => buildSessionPresentationNoticeKeyPrefix(props.address, props.address.sessionId),
        [props.address],
    );
    const addToCompanion = React.useCallback(() => {
        showSessionBoardItemInCompanion({
            companion,
            publishNotice: publishPresentationNotice,
            noticeKeyPrefix,
            itemId: props.itemId,
            revealAfterMutation: props.revealPort.revealAfterMutation,
        });
    }, [companion, noticeKeyPrefix, props.itemId, props.revealPort]);

    return (
        <SessionWidgetHost
            {...props.widgetProps}
            {...(props.addAvailable && companion.availability === 'ready'
                ? { onAddToCompanion: addToCompanion }
                : {})}
        />
    );
}
