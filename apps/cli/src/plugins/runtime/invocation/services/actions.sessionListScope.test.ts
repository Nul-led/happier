import { describe, expect, it, vi } from 'vitest';

import { createPluginInvocationActionsService } from './actions';
import { createPluginActionCallerMaterializationFixture } from './actionCaller.testkit';

describe('plugin invocation session.list scope', () => {
    it.each(['happier.builtin', 'acme.external-installed'] as const)(
        'gives %s Agent Actions the same exact current-Session listing scope',
        async (pluginId) => {
            const execute = vi.fn(async () => ({ ok: true as const, result: { sessions: [] } }));
            const service = createPluginInvocationActionsService({
                seed: {
                    plugin: { id: pluginId, version: '1.0.0' },
                    resolveCurrentPluginMaterializationRef:
                        createPluginActionCallerMaterializationFixture(pluginId)
                            .resolveCurrentPluginMaterializationRef,
                    contribution: { id: 'agent', qualifiedId: `${pluginId}/agents/agent` },
                    occurrenceId: 'occurrenceId-1',
                    correlationId: `${pluginId}-session-list`,
                    surface: 'agent',
                    session: { id: 'admitted-session' },
                    signal: new AbortController().signal,
                    isOccurrenceCurrent: () => true,
                },
                actionExecutor: { execute },
                invokeContributedAction: vi.fn(),
            });

            await expect(service.execute('session.list', {})).resolves.toEqual({ sessions: [] });
            expect(execute).toHaveBeenCalledWith('session.list', {}, expect.objectContaining({
                surface: 'agent',
                defaultSessionId: 'admitted-session',
                sessionListAccess: 'current_session',
            }));
        },
    );
});
