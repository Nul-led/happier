import { describe, expect, it } from 'vitest';
import type { ServerFetch } from '@/sync/http/client';
import { executeApiTokenAction } from './apiTokenActionTransport';

describe('API-token Action transport', () => {
    it('uses the canonical spawn public projection without adding a CORS authority header', async () => {
        let body: unknown;
        let ceiling: string | null = null;
        const request: ServerFetch = async (_path, init) => {
            body = JSON.parse(String(init?.body));
            ceiling = new Headers(init?.headers).get('x-happier-authority-ceiling');
            return new Response(JSON.stringify({ v: 1, actionId: 'session.spawn_new', execution: { ok: true, result: {
                type: 'success', disposition: 'created', sessionId: 'session-1',
                executionTarget: { serverId: 'home', machineId: 'machine' },
                organizationPlacement: { folderId: null, tagIds: [] }, initialInput: { status: 'notRequested' },
            } } }));
        };
        const result = await executeApiTokenAction({ request }, 'session.spawn_new', {
            creationKey: '00000000-0000-4000-8000-000000000001',
            executionTarget: { serverId: 'home', machineId: 'machine' }, directory: { kind: 'managed' },
            agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.codex', localId: 'codex' } },
        }, { surface: 'ui', authority: 'present_user' });
        expect(result.ok).toBe(true);
        expect(ceiling).toBeNull();
        expect(body).toMatchObject({ v: 1, target: { kind: 'machine', machineId: 'machine' }, input: { directory: { kind: 'managed' } } });
        expect(body).not.toHaveProperty('input.executionTarget');
        expect(body).not.toHaveProperty('authority');
    });
    it('refuses an Action response for another Action', async () => {
        const request: ServerFetch = async () => new Response(JSON.stringify({ v: 1, actionId: 'session.message.send', execution: { ok: true, result: {} } }));
        const result = await executeApiTokenAction({ request }, 'action.options.resolve', { actionId: 'session.spawn_new', fieldPath: 'modelSelection' }, { surface: 'ui' });
        expect(result).toMatchObject({ ok: false, errorCode: 'invalid_action_output' });
    });
});
