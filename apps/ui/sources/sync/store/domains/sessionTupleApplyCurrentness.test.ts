import { expect, it } from 'vitest';

import { classifySessionTupleApplyCurrentness } from './sessionTupleApplyCurrentness';

it('admits an authoritative layout-1 privacy contraction without an access projection on the socket frame', () => {
    const previous = {
        metadataLayoutVersion: 0, metadataVersion: 9, agentStateVersion: 8,
        access: undefined, accessLevel: undefined,
    };
    const incoming = {
        metadataLayoutVersion: 1, metadataVersion: 1, agentStateVersion: 1,
        access: undefined, accessLevel: undefined,
    };
    expect(classifySessionTupleApplyCurrentness(previous, incoming)).toEqual({
        metadataCurrent: true, agentStateCurrent: true, fullyCurrent: true,
    });
});
