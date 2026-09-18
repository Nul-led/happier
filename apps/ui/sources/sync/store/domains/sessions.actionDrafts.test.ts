import { beforeEach, describe, expect, it, vi } from 'vitest';

const mmkvStore = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) {
            return mmkvStore.get(key);
        }
        set(key: string, value: string) {
            mmkvStore.set(key, value);
        }
        delete(key: string) {
            mmkvStore.delete(key);
        }
        clearAll() {
            mmkvStore.clear();
        }
    }
    return { MMKV };
});

import { createSessionsDomain } from './sessions';
import { clearPersistence } from '@/sync/domains/state/persistence';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';

const scopeA = { serverId: 'home-a', accountId: 'account-a' } as const;
const scopeB = { serverId: 'home-b', accountId: 'account-b' } as const;
const addressA = { serverId: 'home-a', sessionId: 'shared-session' } as const;
const addressB = { serverId: 'home-b', sessionId: 'shared-session' } as const;

function createHarness() {
    let state: any = {
        sessions: {},
        sessionListIndexByServerId: {},
        sessionListRowsByServerId: {},
        concurrentSessionListCacheByServerId: {},
        sessionScmStatus: {},
        sessionLastViewed: {},
        sessionRepositoryTreeExpandedPathsBySessionId: {},
        workspaceRepositoryTreeExpandedPathsByWorkspaceCacheKey: {},
        reviewCommentsDraftsBySessionId: {},
        reviewCommentsDraftsByWorkspaceCacheKey: {},
        sessionActionDraftsByAddressKey: {},
        isDataReady: false,
        machines: {},
        machineDisplayById: {},
        sessionMessages: {},
        settings: {},
    };

    const get = () => state;
    const set = (updater: any) => {
        const next = typeof updater === 'function' ? updater(state) : updater;
        state = { ...state, ...next };
    };

    const domain = createSessionsDomain({ get, set } as any);
    // Mirror store initialization behavior: domain's initial values are merged into state.
    set(domain as any);
    return { get, domain };
}

describe('sessions domain: action drafts', () => {
    beforeEach(() => {
        clearPersistence();
    });

    it('creates, updates, and deletes action drafts for one exact Session address', () => {
        const { get, domain } = createHarness();

        const created = domain.createSessionActionDraft(scopeA, addressA, {
            actionId: 'review.start',
            input: { changeType: 'committed', base: { kind: 'none' } },
        });

        expect(created.address).toEqual(addressA);
        expect(created.actionId).toBe('review.start');
        expect((get().sessionActionDraftsByAddressKey[sessionAddressKey(addressA)] ?? []).length).toBe(1);

        domain.updateSessionActionDraftInput(scopeA, addressA, created.id, { instructions: 'Review this.' });
        const afterUpdate = (get().sessionActionDraftsByAddressKey[sessionAddressKey(addressA)] ?? [])[0];
        expect(afterUpdate?.input?.instructions).toBe('Review this.');

        domain.setSessionActionDraftStatus(scopeA, addressA, created.id, 'running');
        const afterStatus = (get().sessionActionDraftsByAddressKey[sessionAddressKey(addressA)] ?? [])[0];
        expect(afterStatus?.status).toBe('running');

        domain.deleteSessionActionDraft(scopeA, addressA, created.id);
        expect((get().sessionActionDraftsByAddressKey[sessionAddressKey(addressA)] ?? []).length).toBe(0);
    });

    it('keeps same-ID drafts on two Homes independent across focus and reload', () => {
        const { domain } = createHarness();

        const createdA = domain.createSessionActionDraft(scopeA, addressA, {
            actionId: 'review.start',
            input: { instructions: 'A' },
        });
        domain.clearSessionLocalStateScope();
        domain.activateSessionLocalStateScope(scopeB);
        domain.createSessionActionDraft(scopeB, addressB, {
            actionId: 'review.start',
            input: { instructions: 'B' },
        });

        domain.updateSessionActionDraftInput(scopeB, addressA, createdA.id, { instructions: 'wrong Home' });

        // A handler captured before focus moved to B must still mutate A only.
        domain.updateSessionActionDraftInput(scopeA, addressA, createdA.id, { instructions: 'A updated' });

        const { get: get2, domain: domain2 } = createHarness();
        domain2.activateSessionLocalStateScope(scopeA);
        domain2.activateSessionLocalStateScope(scopeB);
        expect(get2().sessionActionDraftsByAddressKey[sessionAddressKey(addressA)]?.[0]?.input.instructions).toBe('A updated');
        expect(get2().sessionActionDraftsByAddressKey[sessionAddressKey(addressB)]?.[0]?.input.instructions).toBe('B');
    });

    it('removes persisted action drafts when deleting a session', () => {
        const { domain } = createHarness();
        const address = { serverId: scopeA.serverId, sessionId: 's1' } as const;
        domain.createSessionActionDraft(scopeA, address, {
            actionId: 'review.start',
            input: { instructions: 'Review this.', engineIds: ['codex'], changeType: 'committed', base: { kind: 'none' } },
        });

        domain.deleteSession('s1');

        const { get: get2 } = createHarness();
        domain.activateSessionLocalStateScope(scopeA);
        expect(get2().sessionActionDraftsByAddressKey[sessionAddressKey(address)] ?? []).toEqual([]);
    });
});
