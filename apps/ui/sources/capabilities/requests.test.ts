import { describe, expect, it } from 'vitest';

import { CAPABILITIES_REQUEST_MACHINE_DETAILS, buildUpdatesCapabilitiesRequest } from './requests';

describe('CAPABILITIES_REQUEST_MACHINE_DETAILS', () => {
    it('asks for non-agent tools and helpers, leaving agent detection to the inventory owner', () => {
        expect(CAPABILITIES_REQUEST_MACHINE_DETAILS.checklistId).toBeUndefined();
        expect(CAPABILITIES_REQUEST_MACHINE_DETAILS.requests).toEqual(expect.arrayContaining([
            { id: 'tool.tmux' }, { id: 'tool.windowsTerminal' }, { id: 'tool.executionRuns' }, { id: 'dep.gh' },
        ]));
        expect(CAPABILITIES_REQUEST_MACHINE_DETAILS.requests?.some(({ id }) => id.startsWith('cli.'))).toBe(false);
    });
});

describe('buildUpdatesCapabilitiesRequest', () => {
    it('leaves agent probes to the uniform inventory owner while preserving helper and system-task requests', () => {
        const request = buildUpdatesCapabilitiesRequest([{ requests: [{ id: 'dep.gh', params: { includeLatestVersion: true } }] }]);
        expect(request.requests).toEqual([
            { id: 'tool.systemTasks' },
            { id: 'dep.gh', params: { includeLatestVersion: true } },
        ]);
    });
});
