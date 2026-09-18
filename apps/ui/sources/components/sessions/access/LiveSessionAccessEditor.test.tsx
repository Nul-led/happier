import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { upsertServerProfile } from '@/sync/domains/server/serverProfiles';
import type { SessionListIndexItem } from '@/sync/domains/sessionList/sessionListIndex';
import { storage } from '@/sync/domains/state/storage';
import { LiveSessionAccessEditor } from './LiveSessionAccessEditor';

const credentials = vi.hoisted(() => ({ serverId: '', accountId: 'collaboration-account' }));
const credentialMutations = vi.hoisted(() => ({
    listener: null as null | ((event: Readonly<{ kind: 'credentials_set' | 'credentials_removed'; serverId: string; serverUrl: string }>) => void),
}));
const editorLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));
const editorProps = vi.hoisted(() => ({
    last: null as null | Readonly<{ onRequestClose?: () => void; onOpenFullSurface?: () => void }>,
}));

// Device credential storage is the boundary; scope resolution and Session projections remain real.
vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => {
    const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
    return createTokenStorageModuleMock({
        importOriginal,
        tokenStorage: {
            getCredentialsForServerUrl: async (_url, options) => options?.serverId === credentials.serverId ? {
                token: `header.${Buffer.from(JSON.stringify({ sub: credentials.accountId })).toString('base64')}.signature`,
                secret: 'test-secret',
            } : null,
        },
        subscribeHomeCredentialMutations: (listener) => {
            credentialMutations.listener = listener;
            return () => {
                if (credentialMutations.listener === listener) credentialMutations.listener = null;
            };
        },
    });
});

vi.mock('./useLiveSessionAccessEditorController', async () => {
    const ReactModule = await import('react');
    return {
        useLiveSessionAccessEditorController: () => {
            ReactModule.useEffect(() => {
                editorLifecycle.mounts += 1;
                return () => {
                    editorLifecycle.unmounts += 1;
                };
            }, []);
            return {};
        },
    };
});

vi.mock('./SessionAccessEditor', async () => {
    const ReactModule = await import('react');
    const { Text } = await import('react-native');
    return {
        SessionAccessEditor: (props: Readonly<{ testID?: string; onRequestClose?: () => void; onOpenFullSurface?: () => void }>) => {
            editorProps.last = props;
            return ReactModule.createElement(Text, { testID: props.testID }, 'editor');
        },
    };
});

afterEach(() => {
    standardCleanup();
    storage.setState(storage.getInitialState(), true);
    credentialMutations.listener = null;
    editorLifecycle.mounts = 0;
    editorLifecycle.unmounts = 0;
    editorProps.last = null;
});

describe('LiveSessionAccessEditor', () => {
    it('preserves an inactive Home Session projection while resolving its credential identity', async () => {
        const profile = await upsertServerProfile({ name: 'Access test Home', serverUrl: 'https://access-inactive.example.test' });
        credentials.serverId = profile.id;
        const rows = {};
        const index: SessionListIndexItem[] = [];
        storage.setState((state) => ({
            sessionListRowsByServerId: { ...state.sessionListRowsByServerId, [profile.id]: rows },
            sessionListIndexByServerId: { ...state.sessionListIndexByServerId, [profile.id]: index },
        }));

        const screen = await renderScreen(<LiveSessionAccessEditor target={{ serverId: profile.id, sessionId: 'same-id' }} presentation="compact" testID="session-access-editor" />);
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor')).not.toBeNull());
        expect(storage.getState().sessionListRowsByServerId[profile.id]).toBe(rows);
        expect(storage.getState().sessionListIndexByServerId[profile.id]).toBe(index);
    });

    it('forwards the compact host close and full-surface handoff to the mounted editor', async () => {
        const profile = await upsertServerProfile({ name: 'Handoff test Home', serverUrl: 'https://access-handoff.example.test' });
        credentials.serverId = profile.id;
        const onRequestClose = vi.fn();
        const onOpenFullSurface = vi.fn();

        const screen = await renderScreen(<LiveSessionAccessEditor target={{ serverId: profile.id, sessionId: 'handoff' }}
            presentation="compact" onRequestClose={onRequestClose} onOpenFullSurface={onOpenFullSurface}
            testID="session-access-editor" />);
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor')).not.toBeNull());

        editorProps.last?.onRequestClose?.();
        editorProps.last?.onOpenFullSurface?.();
        expect(onRequestClose).toHaveBeenCalledTimes(1);
        expect(onOpenFullSurface).toHaveBeenCalledTimes(1);
    });

    it('remounts its Account-scoped controller when delimiter-bearing Account and Session identities change', async () => {
        const profile = await upsertServerProfile({ name: 'Identity test Home', serverUrl: 'https://access-identity.example.test' });
        credentials.serverId = profile.id;
        credentials.accountId = 'account:left';

        const screen = await renderScreen(<LiveSessionAccessEditor target={{ serverId: profile.id, sessionId: 'tail' }} presentation="compact" testID="session-access-editor" />);
        await vi.waitFor(() => expect(screen.findByTestId('session-access-editor')).not.toBeNull());
        expect(editorLifecycle.mounts).toBe(1);

        credentials.accountId = 'account';
        credentialMutations.listener?.({
            kind: 'credentials_set',
            serverId: profile.id,
            serverUrl: profile.serverUrl,
        });
        await screen.update(<LiveSessionAccessEditor target={{ serverId: profile.id, sessionId: 'left:tail' }} presentation="compact" testID="session-access-editor" />);

        await vi.waitFor(() => expect(editorLifecycle.mounts).toBe(2));
        expect(editorLifecycle.unmounts).toBe(1);
    });
});
