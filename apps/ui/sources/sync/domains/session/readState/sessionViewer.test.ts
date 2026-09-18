import { describe, expect, it } from 'vitest';

import { isSessionPersonallyTrackedForViewer } from './sessionViewer';

describe('isSessionPersonallyTrackedForViewer', () => {
    it('keeps the released owner/access-level fallback only when normalized access is absent', () => {
        expect(isSessionPersonallyTrackedForViewer({})).toBe(true);
        expect(isSessionPersonallyTrackedForViewer({ accessLevel: 'view' })).toBe(false);
    });

    it('fails closed when a malformed current access projection was normalized to null', () => {
        expect(isSessionPersonallyTrackedForViewer({
            access: null,
            accessLevel: undefined,
        })).toBe(false);
    });

    it('does not treat a current sourced owner projection with a missing viewer as pre-viewer', () => {
        expect(isSessionPersonallyTrackedForViewer({
            access: {
                role: 'owner',
                level: 'owner',
                sources: [{ kind: 'owner' }],
                capabilities: {
                    readTranscript: true,
                    submitAgentInput: true,
                    editSessionRecords: true,
                    approveRuntimePermissions: true,
                    manageAccess: true,
                    managePermissionDelegation: true,
                    managePublicLink: true,
                    archiveSession: true,
                    renameSession: true,
                    assignResponsibility: true,
                    stopSession: true,
                    deleteSession: true,
                },
            },
        })).toBe(false);
    });
});
