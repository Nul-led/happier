import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { createStorageModuleStub } from '@/dev/testkit/mocks/storage';
import { t } from '@/text';

const api = vi.hoisted(() => ({ set: vi.fn() }));
const preparation = vi.hoisted(() => ({ run: vi.fn() }));
const connectivity = vi.hoisted(() => ({ online: true }));
const querySource = vi.hoisted(() => ({ refresh: vi.fn(), phase: 'ready', empty: false }));

vi.mock('@/sync/api/session/sessionFollowSourcesApi', () => ({ setSessionFollowSource: api.set }));
vi.mock('./prepareSessionFollowSourceKey', () => ({ prepareSessionFollowSourceKey: preparation.run }));
vi.mock('@/sync/runtime/connectivity/serverReachabilitySupervisorPool', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isServerReachabilityNetworkAllowed: () => connectivity.online,
    subscribeServerReachabilityNetworkAllowed: () => () => undefined,
}));
vi.mock('@/sync/domains/session/listing/useSessionListQuerySourceState', () => ({
    useSessionListQuerySourceState: () => ({
        byServerId: { 'home-a': querySource.empty ? [] : [{ type: 'session', sessionId: 'source-a' }, { type: 'session', sessionId: 'destination-a' }] },
        statesByServerId: { 'home-a': { phase: querySource.phase } },
        coverageComplete: true,
        loadNext: vi.fn(),
        refresh: querySource.refresh,
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
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getServerProfileById: () => ({ name: 'Home' }),
}));
vi.mock('@/modal/components/card/useModalCardChrome', () => ({ useModalCardChrome: () => undefined }));
vi.mock('@/components/ui/selectionList', () => ({
    SelectionList: (props: Record<string, unknown>) => React.createElement('SelectionList', props),
}));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: Record<string, unknown>) => React.createElement('Item', props),
}));
vi.mock('@/components/ui/text/Text', () => ({ Text: (props: Record<string, unknown>) => React.createElement('Text', props) }));

describe('SessionFollowDestinationPickerModal', () => {
    beforeEach(() => {
        api.set.mockReset();
        preparation.run.mockReset();
        querySource.refresh.mockReset();
        connectivity.online = true;
        querySource.phase = 'ready';
        querySource.empty = false;
    });

    it('reserves the rows while the first page loads instead of showing an empty list and a status line', async () => {
        querySource.phase = 'loading';
        querySource.empty = true;
        const { SessionFollowDestinationPickerModal } = await import('./SessionFollowDestinationPickerModal');
        const screen = await renderScreen(<SessionFollowDestinationPickerModal
            source={{ serverId: 'home-a', sessionId: 'source-a' }}
            onClose={vi.fn()}
            setChrome={vi.fn()}
        />);

        expect(screen.findByTestId('session-follow-picker-currentness')).toBeNull();
        expect(screen.findByType('SelectionList').props.contentState?.props.testID).toBe('session-follow-destination-loading');
    });

    it('offers an in-place retry when destination discovery fails for the exact Home', async () => {
        querySource.phase = 'error';
        const { SessionFollowDestinationPickerModal } = await import('./SessionFollowDestinationPickerModal');
        const screen = await renderScreen(<SessionFollowDestinationPickerModal
            source={{ serverId: 'home-a', sessionId: 'source-a' }}
            onClose={vi.fn()}
            setChrome={vi.fn()}
        />);

        const status = screen.findByTestId('session-follow-picker-currentness');
        expect(status?.props.title).toBe(t('sessionsList.queryRefreshFailedTitle'));
        expect(status?.props.detail).toBe(t('common.retry'));
        await act(async () => { status?.props.onPress(); });
        expect(querySource.refresh).toHaveBeenCalledTimes(1);
        // The list and its retained search are untouched by the retry.
        expect(screen.findByTestId('session-follow-destination-list')).not.toBeNull();
    });

    it('preserves the list lifetime offline and refuses a selection from the previous connected render', async () => {
        api.set.mockResolvedValue({ kind: 'error', error: 'network' });
        const { SessionFollowDestinationPickerModal } = await import('./SessionFollowDestinationPickerModal');
        const props = { source: { serverId: 'home-a', sessionId: 'source-a' }, onClose: vi.fn() };
        const screen = await renderScreen(<SessionFollowDestinationPickerModal {...props} />);
        const list = screen.findByType('SelectionList');
        const selectWhileConnected = list.props.onSelect;
        connectivity.online = false;
        await act(async () => { selectWhileConnected('destination-a'); });
        expect(api.set).not.toHaveBeenCalled();
        await screen.update(<SessionFollowDestinationPickerModal {...props} setChrome={vi.fn()} />);
        const retained = screen.findByType('SelectionList');
        expect(retained).toBe(list);
        expect(retained.props.rootStep.sections[0].options).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'destination-a', disabled: true }),
        ]));
        connectivity.online = true;
        await screen.update(<SessionFollowDestinationPickerModal {...props} setChrome={vi.fn()} />);
        await act(async () => { screen.findByType('SelectionList').props.onSelect('destination-a'); });
        expect(api.set).toHaveBeenCalledWith({ serverId: 'home-a', sourceSessionId: 'source-a', destinationSessionId: 'destination-a' });
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
