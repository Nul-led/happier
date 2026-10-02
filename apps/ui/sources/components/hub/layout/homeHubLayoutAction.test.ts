import { describe, expect, it } from 'vitest';
import { createActionExecutor, getActionSpec, type ActionExecutorDeps } from '@happier-dev/protocol';
import type { HomeHubLayoutValue } from './homeHubLayout';
import { getPersistenceStorage } from '@/sync/domains/state/persistenceStorage';
import { readHomeReachNudge, recordFailedHomeReach } from '@/sync/runtime/connectivity/homeReachFailures';

const builtins = [
    { id: 'start', hideable: false },
    { id: 'attention', hideable: false },
    { id: 'setup', hideable: true },
    { id: 'machines', hideable: true, defaultHidden: true },
    { id: 'usage', hideable: true },
];
const widgets = [
    { key: 'acme/latest', homeDefault: 'shown' as const },
    { key: 'acme/builds', homeDefault: 'available' as const },
];

describe('Home layout Actions through the real layout owner', () => {
    it('lets an agent complete or dismiss one setup step in the synced layout, then show it again', async () => {
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        let layout: HomeHubLayoutValue = {
            order: ['start', 'future-section', 'setup'], hidden: ['usage', 'setup:addMachine'],
            sections: { setup: { frameStyle: 'plain' } },
        };
        const action = createHomeHubLayoutAction({
            builtins, isClientTargetCurrent: () => true, readWidgets: () => widgets,
            read: async () => layout, mutate: async (update) => { layout = update(layout); },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        const setHidden = (hidden: boolean) => executor.execute('home.hub.layout.update', {
            intent: { kind: 'setup_visibility', stepId: 'addPhone', hidden },
        }, { surface: 'agent' });
        expect(await setHidden(true)).toMatchObject({ ok: true, result: { hiddenSetupStepIds: ['addMachine', 'addPhone'] } });
        const completed = layout;
        await setHidden(true);
        expect(layout).toBe(completed);
        expect(layout.order).toEqual(['start', 'future-section', 'setup']);
        expect(layout.sections).toEqual({ setup: { frameStyle: 'plain' } });
        expect(await setHidden(false)).toMatchObject({ ok: true, result: { hiddenSetupStepIds: ['addMachine'] } });
        expect(layout.hidden).toEqual(['usage', 'setup:addMachine']);
    });
    it('permanently dismisses the local reach nudge without reading or writing Account settings', async () => {
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const profile = await profiles.upsertServerProfile({ serverUrl: 'https://nudge-action.example.test', name: 'Home' });
        await profiles.setServerProfileIdentityForUrl(profile.serverUrl, 'srv_nudge_action');
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        const action = createHomeHubLayoutAction({
            builtins, isClientTargetCurrent: () => true, readWidgets: () => widgets,
            // Account persistence is outside this device-local operation.
            read: async () => { throw new Error('Unexpected Account settings read'); },
            mutate: async () => { throw new Error('Unexpected Account settings write'); },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        try {
            for (let index = 0; index < 3; index++) recordFailedHomeReach('srv_nudge_action', Date.now());
            expect(readHomeReachNudge('srv_nudge_action', Date.now()).show).toBe(true);
            expect(await executor.execute('home.reachNudge.dismiss', { homeServerId: profile.id }, { surface: 'agent' })).toMatchObject({
                ok: true, result: { homeIdentityId: 'srv_nudge_action', dismissed: true },
            });
            expect(readHomeReachNudge('srv_nudge_action', Date.now()).show).toBe(false);
            expect(await executor.execute('home.reachNudge.dismiss', { homeServerId: 'unknown' }, { surface: 'agent' })).toMatchObject({
                ok: false, errorCode: 'home_not_found',
            });
        } finally {
            await profiles.removeServerProfile(profile.id);
            getPersistenceStorage().delete('home-reach-failures-v2');
            getPersistenceStorage().delete('home-reach-nudge-dismissed-v1');
        }
    });
    it('sets a personal frame override through the canonical Action and preserves it through layout changes', async () => {
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        let layout: HomeHubLayoutValue = { order: [], hidden: [] };
        const action = createHomeHubLayoutAction({
            builtins, isClientTargetCurrent: () => true, readWidgets: () => widgets,
            read: async () => layout, mutate: async (update) => { layout = update(layout); },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        const execute = (intent: unknown) => executor.execute('home.hub.layout.update', { intent }, { surface: 'agent' });
        expect(await execute({ kind: 'frameStyle', sectionId: 'widget:acme/latest', frameStyle: 'plain' })).toMatchObject({
            ok: true, result: { layout: { sections: { 'widget:acme/latest': { frameStyle: 'plain' } } }, sections: expect.arrayContaining([{ id: 'widget:acme/latest', kind: 'widget', hidden: false, hideable: true, frameStyle: 'plain' }]) },
        });
        await execute({ kind: 'move', sectionId: 'widget:acme/latest', step: -1 });
        await execute({ kind: 'visibility', sectionId: 'setup', hidden: true });
        await execute({ kind: 'restore_setup' });
        expect(layout.sections).toEqual({ 'widget:acme/latest': { frameStyle: 'plain' } });
        expect(await execute({ kind: 'frameStyle', sectionId: 'unknown', frameStyle: 'card' })).toMatchObject({ ok: false, errorCode: 'home_hub_section_not_found' });
        expect((await execute({ kind: 'frameStyle', sectionId: 'widget:acme/latest', frameStyle: null })).ok).toBe(true);
        expect(layout.sections).toBeUndefined();
    });
    it('does not disclose or mutate a Home using another mounted Account’s widget inventory', async () => {
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        let current = true;
        let releaseRead: (value: HomeHubLayoutValue) => void = () => {};
        let notifyReadStarted: () => void = () => {};
        const readStarted = new Promise<void>((resolve) => { notifyReadStarted = resolve; });
        const read = new Promise<HomeHubLayoutValue>((resolve) => { releaseRead = resolve; });
        let writes = 0;
        const action = createHomeHubLayoutAction({
            builtins, readWidgets: () => widgets,
            // Focus/account changes are the client environment boundary, not a mocked layout rule.
            isClientTargetCurrent: () => current,
            read: () => { notifyReadStarted(); return read; },
            mutate: async () => { writes++; },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        const pending = executor.execute('home.hub.layout.update', { intent: { kind: 'visibility', sectionId: 'widget:acme/builds', hidden: false } }, { surface: 'ui' });
        await readStarted;
        current = false;
        releaseRead({ order: [], hidden: [] });
        expect(await pending).toMatchObject({ ok: false, errorCode: 'action_target_client_mismatch' });
        expect(writes).toBe(0);
        expect(await executor.execute('home.hub.layout.get', {}, { surface: 'agent' })).toMatchObject({ ok: false, errorCode: 'action_target_client_mismatch' });
    });
    it('customizes widgets and sections, preserves unknown slots and default-hidden sections, and restores setup dismissals', async () => {
        // Fail at the public contract first when the Action is missing.
        expect(getActionSpec('home.hub.layout.update')).toBeTruthy();
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        let layout: HomeHubLayoutValue = { order: ['start', 'newer-section', 'attention', 'setup'], hidden: ['setup:addPhone'] };
        // Account-settings persistence is the system boundary; all layout decisions below it are real.
        const action = createHomeHubLayoutAction({
            builtins,
            isClientTargetCurrent: () => true,
            readWidgets: () => widgets,
            read: async () => layout,
            mutate: async (update) => { layout = update(layout); },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        const execute = (intent: unknown) => executor.execute('home.hub.layout.update', { intent }, { surface: 'ui' });
        expect((await execute({ kind: 'visibility', sectionId: 'widget:acme/builds', hidden: false })).ok).toBe(true);
        expect(layout.order).toContain('widget:acme/builds');
        expect(layout.hidden).toContain('machines');
        expect((await execute({ kind: 'reorder', sectionIds: ['usage', 'start', 'attention', 'setup', 'machines', 'widget:acme/latest', 'widget:acme/builds'] })).ok).toBe(true);
        expect(layout.order[1]).toBe('newer-section');
        expect(layout.order[0]).toBe('usage');
        expect((await execute({ kind: 'visibility', sectionId: 'attention', hidden: true })).ok).toBe(true);
        expect(layout.hidden).not.toContain('attention');
        expect((await execute({ kind: 'restore_setup' })).ok).toBe(true);
        expect(layout.hidden).not.toContain('setup:addPhone');
        expect((await execute({ kind: 'reset' })).ok).toBe(true);
        expect(layout).toEqual({ order: [], hidden: [] });
        const read = await executor.execute('home.hub.layout.get', {}, { surface: 'agent' });
        expect(read).toMatchObject({ ok: true, result: { availableWidgetIds: ['widget:acme/builds'] } });
    });

    it('rejects stale/unknown widget targets and incomplete reorder intents before persisting', async () => {
        expect(getActionSpec('home.hub.layout.update')).toBeTruthy();
        const { createHomeHubLayoutAction } = await import('./homeHubLayoutAction');
        let writes = 0;
        const action = createHomeHubLayoutAction({
            isClientTargetCurrent: () => true,
            builtins, readWidgets: () => widgets,
            read: async () => ({ order: [], hidden: [] }),
            mutate: async (update) => { update({ order: [], hidden: [] }); writes++; },
        });
        const executor = createActionExecutor({ homeHubLayoutAction: action } as ActionExecutorDeps);
        const unknown = await executor.execute('home.hub.layout.update', { intent: { kind: 'visibility', sectionId: 'widget:missing/nope', hidden: false } }, { surface: 'ui' });
        expect(unknown).toMatchObject({ ok: false, errorCode: 'home_hub_section_not_found' });
        const incomplete = await executor.execute('home.hub.layout.update', { intent: { kind: 'reorder', sectionIds: ['start'] } }, { surface: 'ui' });
        expect(incomplete).toMatchObject({ ok: false, errorCode: 'home_hub_order_incomplete' });
        expect(writes).toBe(0);
    });
});
