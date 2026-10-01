import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { getSessionSurfaceVisibilitySnapshot, resetSessionSurfaceVisibilityForTests } from '@/sync/domains/session/sessionSurfaceVisibility';
import { clearMountedSessionRealtimeTranscriptConsumers } from '@/sync/runtime/sessionRealtimeTranscriptConsumers';
import { useVoiceTargetStore } from '@/voice/runtime/voiceTargetStore';
import { useSessionSurfaceActivation } from './useSessionSurfaceActivation';

function Participant(props: Readonly<{ focused: boolean }>) {
    useSessionSurfaceActivation({ sessionId: 'shared', serverId: 'home-a', surfaceVisible: true,
        surfaceFocused: props.focused, routeAnchor: props.focused });
    return null;
}

function Harness(props: Readonly<{ focused: 'a' | 'b'; includeB?: boolean }>) {
    return <><Participant key="a" focused={props.focused === 'a'} />
        {props.includeB !== false ? <Participant key="b" focused={props.focused === 'b'} /> : null}</>;
}

afterEach(async () => {
    await standardCleanup();
    resetSessionSurfaceVisibilityForTests();
    clearMountedSessionRealtimeTranscriptConsumers();
    useVoiceTargetStore.getState().setLastFocusedSessionAddress(null);
});

describe('Session destination focus ownership', () => {
    it('does not let an unfocused duplicate erase the focused sibling markers on mount or focus changes', async () => {
        resetSessionSurfaceVisibilityForTests();
        const screen = await renderScreen(<Harness focused="a" />);
        const expected = { focusedSessionId: 'shared', routeAnchorSessionId: 'shared', visibleSessionIds: ['shared'] };
        expect(getSessionSurfaceVisibilitySnapshot()).toEqual(expected);
        await screen.update(<Harness focused="b" />);
        expect(getSessionSurfaceVisibilitySnapshot()).toEqual(expected);
        await screen.update(<Harness focused="a" />);
        expect(getSessionSurfaceVisibilitySnapshot()).toEqual(expected);
        await screen.update(<Harness focused="a" includeB={false} />);
        expect(getSessionSurfaceVisibilitySnapshot()).toEqual(expected);
        await screen.unmount();
        expect(getSessionSurfaceVisibilitySnapshot()).toEqual({ focusedSessionId: null, routeAnchorSessionId: null, visibleSessionIds: [] });
    });
});
