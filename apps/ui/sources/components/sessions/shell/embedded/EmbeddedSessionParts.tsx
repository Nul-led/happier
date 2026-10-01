import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

import {
    ComposerKeyboardProvider,
    useComposerKeyboardLayout,
} from '@/components/sessions/keyboardAvoidance';
import { SessionViewLayout } from '@/components/sessions/shell/view/SessionViewLayout';
import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { useDeviceType } from '@/utils/platform/responsive';
import { EmbeddedSessionPartSlotPublication } from './EmbeddedSessionPartSlots';

/**
 * What the embedded Session controller publishes: the elements `SessionView` created for this
 * Session, rendered wherever the author's slots sit. There is one composition whatever the
 * arrangement; a slot never binds the Session itself.
 */
export type EmbeddedSessionPartsState = 'ready' | 'loading' | 'unavailable' | 'blocked';

export type EmbeddedSessionPartsValue = Readonly<{
    /** The transcript layer (or the state that stands in for it: loading, unavailable, blocked). */
    transcript: React.ReactNode;
    /** Shown over the transcript layer while the Session has no timeline to render yet. */
    placeholder: React.ReactNode;
    /** `null` for a read-only presentation, or while the Session is not loaded. */
    composer: React.ReactNode | null;
    state: EmbeddedSessionPartsState;
    chatBottomSpacing: 'default' | 'none';
}>;

type PartKind = 'transcript' | 'composer';

/**
 * One claim per part per controller (`SC-R11`): the first mounted slot of a kind renders it and a
 * duplicate renders nothing. The store lives with the controller, so it outlives the Session
 * state transitions that re-publish the parts.
 */
type EmbeddedSessionPartClaims = Readonly<{
    subscribe: (listener: () => void) => () => void;
    owner: (part: PartKind) => string | null;
    claim: (part: PartKind, id: string) => void;
    release: (part: PartKind, id: string) => void;
}>;

function createEmbeddedSessionPartClaims(): EmbeddedSessionPartClaims {
    const owners: Record<PartKind, string | null> = { transcript: null, composer: null };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of Array.from(listeners)) listener();
    };
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        owner: (part) => owners[part],
        claim: (part, id) => {
            if (owners[part] !== null) return;
            owners[part] = id;
            emit();
        },
        release: (part, id) => {
            if (owners[part] !== id) return;
            owners[part] = null;
            emit();
        },
    };
}

const EmbeddedSessionPartClaimsContext = React.createContext<EmbeddedSessionPartClaims | null>(null);
const EmbeddedSessionPartsContext = React.createContext<EmbeddedSessionPartsValue | null>(null);

/**
 * Mounted once by the embedded controller, above the per-Session surface, so the claims survive
 * the parts being re-published as the Session moves between loading, ready and blocked. A nested
 * scope reuses the enclosing one.
 */
export function EmbeddedSessionPartClaimsScope(props: Readonly<{ children: React.ReactNode }>) {
    const enclosing = React.useContext(EmbeddedSessionPartClaimsContext);
    const [ownClaims] = React.useState(createEmbeddedSessionPartClaims);
    const claims = enclosing ?? ownClaims;
    return (
        <EmbeddedSessionPartClaimsContext.Provider value={claims}>
            {props.children}
        </EmbeddedSessionPartClaimsContext.Provider>
    );
}

/** Published by `SessionView`'s embedded arm around the arrangement it renders. */
export function EmbeddedSessionPartsProvider(props: Readonly<{
    value: EmbeddedSessionPartsValue;
    children: React.ReactNode;
}>) {
    return (
        <EmbeddedSessionPartSlotPublication value={props.value}>
            <EmbeddedSessionArrangementPartsProvider value={props.value}>
                {props.children}
            </EmbeddedSessionArrangementPartsProvider>
        </EmbeddedSessionPartSlotPublication>
    );
}

/** The stable arrangement consumes slots, not the producer's contextual elements. */
export function EmbeddedSessionArrangementPartsProvider(props: Readonly<{ value: EmbeddedSessionPartsValue; children: React.ReactNode }>) {
    return <EmbeddedSessionPartsContext.Provider value={props.value}>{props.children}</EmbeddedSessionPartsContext.Provider>;
}

export function useEmbeddedSessionParts(): EmbeddedSessionPartsValue | null {
    return React.useContext(EmbeddedSessionPartsContext);
}

const NO_CLAIMS: EmbeddedSessionPartClaims = createEmbeddedSessionPartClaims();

function useEmbeddedSessionPartClaim(parts: readonly PartKind[]): boolean {
    const claims = React.useContext(EmbeddedSessionPartClaimsContext);
    const store = claims ?? NO_CLAIMS;
    const id = React.useId();
    const partsKey = parts.join('|');
    const readOwners = React.useCallback(
        () => partsKey.split('|').map((part) => store.owner(part as PartKind) ?? '').join('|'),
        [partsKey, store],
    );
    const owners = React.useSyncExternalStore(store.subscribe, readOwners, readOwners);
    React.useLayoutEffect(() => {
        if (!claims) return;
        const claimed = partsKey.split('|') as PartKind[];
        // Claim every part or none: a standard layout beside a loose part must not end up holding
        // half a composition.
        if (claimed.some((part) => claims.owner(part) !== null && claims.owner(part) !== id)) return;
        for (const part of claimed) claims.claim(part, id);
        return () => {
            for (const part of claimed) claims.release(part, id);
        };
    }, [claims, id, owners, partsKey]);
    if (!claims) return false;
    return parts.every((part) => store.owner(part) === id);
}

/** The live transcript with its prompts; fills the remaining height of its bounded flex column. */
export function EmbeddedSessionTranscriptPart(props: Readonly<{ testID?: string }>) {
    const parts = useEmbeddedSessionParts();
    const owns = useEmbeddedSessionPartClaim(TRANSCRIPT_PART);
    const { theme } = useUnistyles();
    if (!parts || !owns) return null;
    return (
        <View
            testID={props.testID ?? 'embedded-session-transcript'}
            style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: theme.colors.surface.base,
            }}
        >
            {parts.transcript ? (
                <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, minWidth: 0 }}>
                    {parts.transcript}
                </View>
            ) : null}
            {parts.placeholder ? (
                <View
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {parts.placeholder}
                </View>
            ) : null}
        </View>
    );
}

/**
 * The Session's composer at its natural height. It carries the keyboard and bottom safe-area lift
 * the full view applies, so on native it must be the bottom element of a region that reaches the
 * screen bottom. It renders nothing for a read-only presentation.
 */
export function EmbeddedSessionComposerPart(props: Readonly<{ testID?: string }>) {
    const parts = useEmbeddedSessionParts();
    const owns = useEmbeddedSessionPartClaim(COMPOSER_PART);
    if (!parts || !owns || parts.composer == null) return null;
    return (
        <EmbeddedSessionComposerFrame testID={props.testID ?? 'embedded-session-composer'}>
            {parts.composer}
        </EmbeddedSessionComposerFrame>
    );
}

function EmbeddedSessionComposerFrame(props: Readonly<{ testID: string; children: React.ReactNode }>) {
    const { theme } = useUnistyles();
    const safeArea = useChromeSafeAreaInsets();
    const layout = useComposerKeyboardLayout({ safeAreaBottom: safeArea.bottom });
    const liftStyle = useAnimatedStyle(() => ({ paddingBottom: layout.bottomInset.value }), [layout]);
    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        layout.setComposerMeasuredHeight(event.nativeEvent.layout.height);
    }, [layout]);
    return (
        <ComposerKeyboardProvider layout={layout}>
            <Animated.View
                testID={props.testID}
                onLayout={handleLayout}
                style={[{ minWidth: 0, backgroundColor: theme.colors.surface.base }, liftStyle]}
            >
                {props.children}
            </Animated.View>
        </ComposerKeyboardProvider>
    );
}

const TRANSCRIPT_PART: readonly PartKind[] = ['transcript'];
const COMPOSER_PART: readonly PartKind[] = ['composer'];
const STANDARD_PARTS: readonly PartKind[] = ['transcript', 'composer'];
const noop = () => {};

/**
 * The host's standard arrangement — transcript, then composer — used by `SessionChat` and by the
 * embed route. It is the full Session view's own layout, so keyboard handling, content width and
 * the transcript's scroll ownership are exactly the incumbent's.
 */
export function EmbeddedSessionStandardLayout(props: Readonly<{ testID?: string }>) {
    const parts = useEmbeddedSessionParts();
    const owns = useEmbeddedSessionPartClaim(STANDARD_PARTS);
    const deviceType = useDeviceType();
    if (!parts || !owns) return null;
    return (
        <View testID={props.testID ?? 'embedded-session-standard-layout'} style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
            <SessionViewLayout
                content={parts.transcript}
                input={parts.composer}
                placeholder={parts.placeholder}
                shouldShowCliWarning={false}
                onDismissCliWarning={noop}
                isLandscape={false}
                deviceType={deviceType}
                onBackPress={noop}
                chatBottomSpacing={parts.chatBottomSpacing}
            />
        </View>
    );
}

/**
 * Publishes a state that stands in for a loaded Session (loading, unavailable, blocked) as the
 * transcript part, with no composer, into the host's arrangement. The arrangement stays mounted and
 * the state fills the transcript slot, exactly as a loaded Session would.
 */
export function EmbeddedSessionStatePublication(props: Readonly<{
    state: Exclude<EmbeddedSessionPartsState, 'ready'>;
    transcript: React.ReactNode;
    arrangement?: React.ReactNode;
}>) {
    const value = React.useMemo<EmbeddedSessionPartsValue>(() => ({
        transcript: props.transcript,
        placeholder: null,
        composer: null,
        state: props.state,
        chatBottomSpacing: 'none',
    }), [props.state, props.transcript]);
    return (
        <EmbeddedSessionPartClaimsScope>
            <EmbeddedSessionPartsProvider value={value}>
                {props.arrangement ?? <EmbeddedSessionStandardLayout />}
            </EmbeddedSessionPartsProvider>
        </EmbeddedSessionPartClaimsScope>
    );
}
