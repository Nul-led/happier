import { describe, expect, it } from 'vitest';

import {
    TRIAGE_UNREAD_ACTIONS_V1,
    readTriageActionsProjectionV1,
} from './actionsCommand.js';

describe('the mounted action catalog projection', () => {
    it('offers no executable seed before Account KV has authoritatively answered absent', () => {
        expect(TRIAGE_UNREAD_ACTIONS_V1).toEqual({
            kind: 'unreadable',
            value: { v: 1, actions: [] },
        });

        expect(readTriageActionsProjectionV1({
            availability: 'absent',
            actions: [{
                actionId: 'ask',
                label: 'Ask',
                enabled: true,
                appliesTo: ['issue'],
                profileId: null,
                workspaceMode: 'reference_only',
                target: { kind: 'agent', promptInvocationId: null, delivery: 'compose' },
            }],
        }).value.actions).toHaveLength(1);
    });
});
