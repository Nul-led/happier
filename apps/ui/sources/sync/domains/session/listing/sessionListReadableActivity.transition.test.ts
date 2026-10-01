import { expect, it } from 'vitest';
import { createAgentEventMessageFixture, createAgentTransitionDividerEventFixture } from '../../../../../../../packages/session-core/src/testkit/sessionAgentTransitionFixtures.js';
import { createSessionListReadableActivityAccumulator, foldSessionListReadableActivityMessage } from './sessionListReadableActivity';

it('does not advance unread or meaningful activity for a transition divider', () => {
    const accumulator = createSessionListReadableActivityAccumulator();
    const agentMessage = {
        id: 'agent-1', kind: 'agent-text' as const, localId: null, createdAt: 1_000, seq: 10, text: 'hello',
    };
    foldSessionListReadableActivityMessage(accumulator, agentMessage);
    const afterAgentText = { ...accumulator };
    foldSessionListReadableActivityMessage(accumulator, createAgentEventMessageFixture(createAgentTransitionDividerEventFixture()));
    expect(accumulator).toEqual(afterAgentText);
    expect(accumulator.latestCommittedMessageSeq).toBe(10);
    expect(accumulator.latestCommittedMessageCreatedAt).toBe(1_000);
});
