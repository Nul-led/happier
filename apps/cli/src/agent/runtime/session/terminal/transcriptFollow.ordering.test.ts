import { describe, expect, it } from 'vitest';
import { createHostTerminalTranscriptFollowService } from './transcriptFollow';

const loadCompleteBaseline = async () => ({ localIds: new Set<string>(), complete: true });

describe('ordered source-follow admission', () => {
    it('shares one ordered source between runtime and local terminal consumers until both release it', async () => {
        let releaseAdmission!: () => void;
        const admission = new Promise<void>((resolve) => { releaseAdmission = resolve; });
        let sources = 0;
        let closed = 0;
        let sourceSignal: AbortSignal | undefined;
        const runtimeAbort = new AbortController();
        const localAbort = new AbortController();
        const service = createHostTerminalTranscriptFollowService({
            loadCommittedLocalIdBaseline: loadCompleteBaseline,
            followProviderSession: async (request, listener) => {
                sourceSignal = request.signal;
                sources += 1;
                await admission;
                await listener({ kind: 'data', phase: 'initial_replay', items: [], fromCursor: null, nextCursor: 'tail' });
                return { status: 'following', startingCursor: 'tail',
                    subscription: { dispose: async () => { closed += 1; } } };
            },
            signal: new AbortController().signal,
            publish: async () => undefined,
        });
        const runtime = service.bindProviderSession({ agentId: 'claude', providerSessionId: 'shared', replay: 'fresh', signal: runtimeAbort.signal });
        const local = service.bindProviderSession({ agentId: 'claude', providerSessionId: 'shared', replay: 'historical', signal: localAbort.signal });
        releaseAdmission();
        const [runtimeBinding, localBinding] = await Promise.all([runtime, local]);
        try {
            expect(sources).toBe(1);
            expect(runtimeBinding.status).toBe('following');
            expect(localBinding.status).toBe('following');
            runtimeAbort.abort();
            if (runtimeBinding.status === 'following') await runtimeBinding.binding.dispose();
            expect(closed).toBe(0);
            expect(sourceSignal?.aborted).toBe(false);
            if (localBinding.status === 'following') await localBinding.binding.dispose();
            expect(closed).toBe(1);
        } finally {
            await service.releaseActiveBindings();
        }
    });

    it('admits fresh source catch-up only after the committed baseline loads', async () => {
        const sourceRows: string[] = ['history'];
        let baselineLoaded = false;
        const published: Array<Readonly<{ phase?: 'initial_replay'; id: string }>> = [];
        const service = createHostTerminalTranscriptFollowService({
            loadCommittedLocalIdBaseline: async () => {
                sourceRows.push('fresh-native-consumption');
                baselineLoaded = true;
                return { localIds: new Set<string>(), complete: true };
            },
            followProviderSession: async (request, listener) => {
                expect(baselineLoaded).toBe(true);
                expect(request.replay).toBe('fresh');
                const items = (ids: readonly string[]) => ids.map((id) => ({
                    id, kind: 'agent' as const, data: { role: 'agent', content: { type: 'text', text: id } },
                }));
                await listener({ kind: 'data', items: items(sourceRows),
                    fromCursor: null, nextCursor: 'live' });
                return { status: 'following', startingCursor: 'cutoff', subscription: { dispose: async () => undefined } };
            },
            signal: new AbortController().signal,
            publish: async (event) => {
                if (event.kind === 'data') for (const item of event.items) published.push({ phase: event.phase, id: item.id });
            },
        });
        const bound = await service.bindProviderSession({ agentId: 'claude', providerSessionId: 'native-session', replay: 'fresh' });
        try {
            expect(bound.status).toBe('following');
            expect(published).toContainEqual({ phase: undefined, id: 'fresh-native-consumption' });
        } finally {
            if (bound.status === 'following') await bound.binding.dispose();
        }
    });

});
