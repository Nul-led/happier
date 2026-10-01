import * as React from 'react';
import { Platform } from 'react-native';
import Animated from 'react-native-reanimated';

import { requireReactDOM } from '@/utils/web/reactDomCjs';
import type { EmbeddedSessionPartsValue } from './EmbeddedSessionParts';

type SlotKind = 'transcript' | 'placeholder' | 'composer';
type Slots = Readonly<Record<SlotKind, HTMLDivElement>>;
type Publication = Readonly<{ id: string; state: EmbeddedSessionPartsValue['state']; hasComposer: boolean; hasPlaceholder: boolean; chatBottomSpacing: EmbeddedSessionPartsValue['chatBottomSpacing'] }>;
type SlotHost = Readonly<{ slots: Slots; publish: (value: Publication | null, id: string) => void; readyEntering: React.ComponentProps<typeof Animated.View>['entering'] }>;
const SlotHostContext = React.createContext<SlotHost | null>(null);

function Slot(props: Readonly<{ container: HTMLDivElement; fill: boolean }>) {
    const attach = React.useCallback((node: HTMLDivElement | null) => {
        if (node) node.appendChild(props.container);
    }, [props.container]);
    return <div ref={attach} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, ...(props.fill ? { flex: 1 } : {}) }} />;
}

/** Physical web slots outlive a new-chat handoff; producers retain all of their React contexts. */
export function EmbeddedSessionStablePartsScope(props: Readonly<{
    children: React.ReactNode;
    renderArrangement: (parts: EmbeddedSessionPartsValue) => React.ReactNode;
    /** The provider's existing handoff motion, applied to the visible portal contents on web. */
    readyEntering?: React.ComponentProps<typeof Animated.View>['entering'];
}>) {
    const [slots] = React.useState<Slots | null>(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
        const makeSlot = (fill: boolean) => {
            const node = document.createElement('div');
            Object.assign(node.style, { display: 'flex', flexDirection: 'column', minWidth: '0', minHeight: '0', ...(fill ? { flex: '1' } : {}) });
            return node;
        };
        return { transcript: makeSlot(true), placeholder: makeSlot(false), composer: makeSlot(false) };
    });
    const [publication, setPublication] = React.useState<Publication | null>(null);
    const publish = React.useCallback((value: Publication | null, id: string) => {
        setPublication((current) => value
            ? current?.id === value.id && current.state === value.state && current.hasComposer === value.hasComposer
                && current.hasPlaceholder === value.hasPlaceholder && current.chatBottomSpacing === value.chatBottomSpacing ? current : value
            : current?.id === id ? null : current);
    }, []);
    const host = React.useMemo(() => slots ? { slots, publish, readyEntering: props.readyEntering } : null, [props.readyEntering, publish, slots]);
    const parts = React.useMemo<EmbeddedSessionPartsValue | null>(() => slots ? {
        transcript: <Slot container={slots.transcript} fill />,
        placeholder: publication?.hasPlaceholder ? <Slot container={slots.placeholder} fill={false} /> : null,
        composer: publication?.hasComposer ? <Slot container={slots.composer} fill={false} /> : null,
        state: publication?.state ?? 'loading',
        chatBottomSpacing: publication?.chatBottomSpacing ?? 'none',
    } : null, [publication?.chatBottomSpacing, publication?.hasComposer, publication?.hasPlaceholder, publication?.state, slots]);
    if (!host || !parts) return props.children;
    return <SlotHostContext.Provider value={host}>
        {props.children}
        {props.renderArrangement(parts)}
    </SlotHostContext.Provider>;
}

/** Portal transport only: no session binding, draft, or lifecycle authority is moved here. */
export function EmbeddedSessionPartSlotPublication(props: Readonly<{
    value: EmbeddedSessionPartsValue;
    children: React.ReactNode;
}>) {
    const host = React.useContext(SlotHostContext);
    const id = React.useId();
    const { state, chatBottomSpacing } = props.value;
    const hasComposer = props.value.composer !== null;
    const hasPlaceholder = props.value.placeholder !== null;
    React.useLayoutEffect(() => {
        if (!host) return;
        host.publish({ id, state, chatBottomSpacing, hasComposer, hasPlaceholder }, id);
        return () => host.publish(null, id);
    }, [chatBottomSpacing, hasComposer, hasPlaceholder, host, id, state]);
    if (!host) return props.children;
    // The shared boundary avoids importing react-dom into native bundles.
    const reactDOM = requireReactDOM() as Pick<typeof import('react-dom'), 'createPortal'>;
    const entering = state === 'ready' ? host.readyEntering : undefined;
    const transcript = entering ? <Animated.View entering={entering} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{props.value.transcript}</Animated.View> : props.value.transcript;
    const composer = entering && hasComposer ? <Animated.View entering={entering} style={{ minWidth: 0 }}>{props.value.composer}</Animated.View> : props.value.composer;
    return <>
        {reactDOM.createPortal(transcript, host.slots.transcript)}
        {reactDOM.createPortal(props.value.placeholder, host.slots.placeholder)}
        {reactDOM.createPortal(composer, host.slots.composer)}
    </>;
}
