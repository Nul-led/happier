import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { t } from '@/text';

const api = vi.hoisted(() => ({ set: vi.fn() }));
const preparation = vi.hoisted(() => ({ run: vi.fn() }));
const connectivity = vi.hoisted(() => ({ online: true }));

vi.mock('@/sync/api/session/sessionFollowSourcesApi', () => ({ setSessionFollowSource: api.set }));
vi.mock('./prepareSessionFollowSourceKey', () => ({ prepareSessionFollowSourceKey: preparation.run }));
vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', () => ({
    isServerReachabilityNetworkAllowed: () => connectivity.online,
    subscribeServerReachabilityNetworkAllowed: () => () => undefined,
}));
vi.mock('@/sync/domains/session/listing/useSessionListQuerySourceState', () => ({
    useSessionListQuerySourceState: () => ({
        byServerId: { 'home-a': [{ type: 'session', sessionId: 'source-a' }, { type: 'session', sessionId: 'destination-a' }] },
        statesByServerId: { 'home-a': { kind: 'ready', complete: true } },
        coverageComplete: true,
        loadNext: vi.fn(),
    }),
}));
vi.mock('@/sync/domains/session/sessionAddress', () => ({
    sessionAddressKey: ({ serverId, sessionId }: { serverId: string; sessionId: string }) => `${serverId}:${sessionId}`,
}));
vi.mock('@/sync/domains/state/storage', () => createStorageModuleStub({
    useMachineListByServerId: () => ({ 'home-a': [] }),
    useSessionListRowRenderablesForItems: () => new Map([
        ['home-a:source-a', { id: 'source-a', serverId: 'home-a', active: true, metadata: { machineId: 'machine-a', path: '/source' } }],
        ['home-a:destination-a', { id: 'destination-a', serverId: 'home-a', active: true, metadata: { machineId: 'runner-a', path: '/destination' } }],
    ]),
}));
vi.mock('./resolveSessionFollowDestinationTargets', () => ({
    resolveSessionFollowDestinationTargets: ({ sessions }: { sessions: unknown[] }) => sessions,
    resolveSessionFollowSourceTargets: ({ sessions }: { sessions: unknown[] }) => sessions,
}));
vi.mock('./sessionFollowPickerPresentation', () => ({
    buildSessionFollowPickerContextTitle: () => 'Follow',
    resolveSessionFollowPickerPresentation: () => ({ canSelect: true, statusKey: null }),
}));
vi.mock('@/sync/domains/session/listing/sessionListIndexPresentation', () => ({
    resolveSessionListQueryPresentation: () => ({ kind: 'ready', complete: true }),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({ getServerProfileById: () => ({ name: 'Home' }) }));
vi.mock('@/modal/components/card/useModalCardChrome', () => ({ useModalCardChrome: () => undefined }));
vi.mock('@/components/ui/selectionList', () => ({
    SelectionList: (props: unknown) => React.createElement('SelectionList', props),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: unknown) => React.createElement('Item', props),
}));
vi.mock('@/components/ui/text/Text', () => ({ Text: (props: unknown) => React.createElement('Text', props) }));

describe('SessionFollowDestinationPickerModal', () => {
    beforeEach(() => {
        api.set.mockReset();
        preparation.run.mockReset();
        connectivity.online = true;
    });

    it('commits the edge before preparation and keeps a reachable Retry action when preparation waits', async () => {
        const order: string[] = [];
        api.set.mockImplementation(async () => { order.push('set'); return { kind: 'ok', value: {} }; });
        preparation.run.mockImplementation(async () => { order.push('prepare'); return { kind: 'waiting', reason: 'runner_unreachable' }; });
        const onClose = vi.fn();
        const onChanged = vi.fn();
        const { SessionFollowDestinationPickerModal } = await import('./SessionFollowDestinationPickerModal');
        const screen = await renderScreen(<SessionFollowDestinationPickerModal
            destination={{ serverId: 'home-a', sessionId: 'destination-a' }}
            onClose={onClose}
            onChanged={onChanged}
        />);

        await act(async () => {
            screen.findByType('SelectionList').props.onSelect('source-a');
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(order).toEqual(['set', 'prepare']);
        expect(onClose).not.toHaveBeenCalled();
        const retry = screen.findByType('Item');
        expect(retry.props.testID).toBe('session-follow-source-key-waiting');
        await act(async () => { retry.props.onPress(); await Promise.resolve(); });
        expect(preparation.run).toHaveBeenCalledTimes(2);
    });

    it('asks for a daemon update instead of offering a retry the outdated runtime cannot satisfy', async () => {
        api.set.mockResolvedValue({ kind: 'ok', value: {} });
        preparation.run.mockResolvedValue({ kind: 'waiting', reason: 'unsupported' });
        const { SessionFollowDestinationPickerModal } = await import('./SessionFollowDestinationPickerModal');
        const screen = await renderScreen(<SessionFollowDestinationPickerModal
            destination={{ serverId: 'home-a', sessionId: 'destination-a' }}
            onClose={vi.fn()}
        />);

        await act(async () => {
            screen.findByType('SelectionList').props.onSelect('source-a');
            await Promise.resolve();
            await Promise.resolve();
        });

        const waiting = screen.findByType('Item');
        expect(waiting.props.testID).toBe('session-follow-source-key-waiting');
        expect(waiting.props.title).toBe(t('session.follow.sources.unsupported'));
        // Repeating the same preparation against the same outdated runtime cannot
        // succeed; the readiness effect already re-attempts once the destination
        // Machine reports new capabilities.
        expect(waiting.props.detail).toBeUndefined();
        expect(waiting.props.onPress).toBeUndefined();
    });
});
