import { describe, expect, it } from 'vitest';

import { normalizeSessionAccessProjection, readSessionAccessRole } from './normalizeSessionAccessProjection';

const capabilities = {
    readTranscript: true, submitAgentInput: true, editSessionRecords: false,
    approveRuntimePermissions: false, manageAccess: false, managePermissionDelegation: false,
    managePublicLink: false, archiveSession: false, renameSession: false,
    assignResponsibility: false, stopSession: false, deleteSession: false,
};

describe('Session access ingress', () => {
    it('uses strict Team capabilities verbatim without inventing owner authority or a direct share', () => {
        const row = { effectiveAccess: {
            v: 1, level: 'edit', sources: [{ kind: 'team', teamId: 'team-1', requiredByTeamPolicy: false }],
            capabilities,
        } };
        expect(normalizeSessionAccessProjection(row)).toMatchObject({ role: 'recipient', level: 'edit', capabilities,
            sources: row.effectiveAccess.sources,
        });
        expect(readSessionAccessRole(row)).toBe('recipient');
    });

    it('preserves bounded Group context separately from decisive Team authority', () => {
        const audienceContext = { kind: 'group', teamId: 'team-1', groupId: 'group-1' };
        const row = { effectiveAccess: { v: 1, level: 'edit', capabilities,
            sources: [{ kind: 'team', teamId: 'team-1', requiredByTeamPolicy: false }], audienceContext,
        } };
        expect(normalizeSessionAccessProjection(row)).toMatchObject({ audienceContext });
        expect(normalizeSessionAccessProjection({ effectiveAccess: {
            ...row.effectiveAccess, audienceContext: { ...audienceContext, unrelatedGroups: ['secret'] },
        } })).toBeNull();
    });

    it('fails closed for missing or malformed current authority even when legacy owner data is present', () => {
        expect(normalizeSessionAccessProjection({ share: null })).toBeNull();
        expect(normalizeSessionAccessProjection({ effectiveAccess: { v: 1, level: 'owner', capabilities: {} }, share: null }, { allowLegacy: true })).toBeNull();
        expect(readSessionAccessRole({})).toBe('unavailable');
    });

    it('confines released owner/direct translation to the explicit compatibility branch', () => {
        expect(readSessionAccessRole({ share: null, metadataLayoutVersion: 1 }, { allowLegacy: true })).toBe('owner');
        expect(readSessionAccessRole({ metadataLayoutVersion: 1 }, { allowLegacy: true })).toBe('unavailable');
        const direct = normalizeSessionAccessProjection({ share: { accessLevel: 'admin', canApprovePermissions: true } }, { allowLegacy: true });
        expect(direct).toMatchObject({ role: 'recipient', capabilities: { manageAccess: true, approveRuntimePermissions: true, managePermissionDelegation: true, managePublicLink: false } });
    });
});
