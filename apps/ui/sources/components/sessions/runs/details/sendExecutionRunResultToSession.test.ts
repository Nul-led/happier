import { describe, expect, it, vi } from 'vitest';

import { sendExecutionRunResultToSession } from './sendExecutionRunResultToSession';

describe('sendExecutionRunResultToSession', () => {
    it('appends the result to the lead composer through the initial-prompt handoff, then reveals and focuses it', async () => {
        const order: string[] = [];
        const writeInitialPrompt = vi.fn(async () => { order.push('write'); });
        const sent = await sendExecutionRunResultToSession({
            sessionId: 'lead_1',
            serverId: 'home_1',
            resultText: '  Checkpoint per batch.  ',
            runTitle: 'Add a resume point',
            template: 'From {{SOURCE_SESSION_NAME}}:\n{{MESSAGES}}',
            nowMs: () => 42,
            writeInitialPrompt,
            revealPrimaryComposer: () => { order.push('reveal'); },
            focusPrimaryComposer: () => { order.push('focus'); },
        });

        expect(sent).toBe(true);
        expect(writeInitialPrompt).toHaveBeenCalledWith({
            destinationSessionId: 'lead_1',
            serverId: 'home_1',
            prompt: {
                v: 1,
                text: 'From Add a resume point:\nCheckpoint per batch.',
                mode: 'append',
                createdAtMs: 42,
                sourceSessionId: 'lead_1',
            },
        });
        expect(order).toEqual(['write', 'reveal', 'focus']);
    });

    it('stages nothing for an empty result', async () => {
        const writeInitialPrompt = vi.fn(async () => undefined);
        await expect(sendExecutionRunResultToSession({
            sessionId: 'lead_1', serverId: 'home_1', resultText: '   ', runTitle: null, template: '', nowMs: () => 1,
            writeInitialPrompt, revealPrimaryComposer: vi.fn(), focusPrimaryComposer: vi.fn(),
        })).resolves.toBe(false);
        expect(writeInitialPrompt).not.toHaveBeenCalled();
    });
});
