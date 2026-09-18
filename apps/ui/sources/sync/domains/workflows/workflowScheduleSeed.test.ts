import { describe, expect, it } from 'vitest';

import {
    buildWorkflowScheduleSeed,
    readWorkflowScheduleSeed,
    storeWorkflowScheduleSeed,
    describeWorkflowScheduleProvenance,
} from './workflowScheduleSeed';
import {
    createWorkflowEditorDraft,
    setWorkflowDefaultField,
    setWorkflowStepText,
    type WorkflowEditorDraft,
} from './workflowEditorDraft';

const AGENT_TARGET = { kind: 'agent' as const, identity: { pluginId: 'happier.agent.claude', localId: 'claude' } };
const REVISION = { headerVersion: 2, bodyVersion: 5 } as const;
const PROJECT = { machineId: 'machine-1', directory: '/repo/project' } as const;

function draft(name = 'Release check'): WorkflowEditorDraft {
    return setWorkflowDefaultField(
        createWorkflowEditorDraft({
            draftId: 'draft-1',
            name,
            blocks: [{
                kind: 'step',
                id: 'analyze',
                document: { text: 'Analyze the release', references: [], attachments: [] },
                input: [],
                result: { kind: 'text' },
            }],
        }),
        'agentTarget',
        AGENT_TARGET,
    );
}

describe('workflow schedule seed', () => {
    it('carries the reviewed definition, not the draft container', () => {
        const seed = buildWorkflowScheduleSeed({ draft: draft(), saved: null, project: PROJECT });
        expect(seed.kind).toBe('available');
        if (seed.kind !== 'available') throw new Error('unreachable');
        expect(seed.seed.name).toBe('Release check');
        expect(seed.seed.definition.blocks[0]?.id).toBe('analyze');
        expect(seed.seed.project).toEqual(PROJECT);
        // The draft id is editing-session state and must not travel.
        expect(JSON.stringify(seed.seed)).not.toContain('draft-1');
    });

    it('refuses to schedule an invalid draft instead of freezing broken content', () => {
        const invalid = setWorkflowStepText(draft(), 'analyze', '');
        const seed = buildWorkflowScheduleSeed({ draft: invalid, saved: null, project: PROJECT });
        expect(seed.kind).toBe('invalid');
        if (seed.kind !== 'invalid') throw new Error('unreachable');
        expect(seed.issues.length).toBeGreaterThan(0);
    });

    it('claims the saved revision only when the draft still matches it', () => {
        const clean = draft();
        const seed = buildWorkflowScheduleSeed({
            draft: clean,
            project: PROJECT,
            saved: { definitionId: 'definition-1', revision: REVISION, definition: clean },
        });
        if (seed.kind !== 'available') throw new Error('unreachable');
        expect(seed.seed.origin).toEqual({
            definitionId: 'definition-1',
            revision: REVISION,
            matchesSavedRevision: true,
        });
    });

    it('keeps origin provenance but drops the revision claim once the draft differs', () => {
        const saved = draft();
        const edited = setWorkflowStepText(saved, 'analyze', 'Analyze the release candidate');
        const seed = buildWorkflowScheduleSeed({
            draft: edited,
            project: PROJECT,
            saved: { definitionId: 'definition-1', revision: REVISION, definition: saved },
        });
        if (seed.kind !== 'available') throw new Error('unreachable');
        expect(seed.seed.origin).toEqual({
            definitionId: 'definition-1',
            revision: REVISION,
            matchesSavedRevision: false,
        });
        // The copied content is the edited draft, never the stale saved bytes.
        const step = seed.seed.definition.blocks[0] as { document: { text: string } };
        expect(step.document.text).toBe('Analyze the release candidate');
    });

    it('describes the copy honestly for each provenance case', () => {
        expect(describeWorkflowScheduleProvenance(null)).toBe('unsaved');
        expect(describeWorkflowScheduleProvenance({
            definitionId: 'definition-1', revision: REVISION, matchesSavedRevision: true,
        })).toBe('savedRevision');
        expect(describeWorkflowScheduleProvenance({
            definitionId: 'definition-1', revision: REVISION, matchesSavedRevision: false,
        })).toBe('editedSinceSave');
    });

    it('passes the seed through the temporary store so no private content enters the route', () => {
        const built = buildWorkflowScheduleSeed({ draft: draft(), saved: null, project: PROJECT });
        if (built.kind !== 'available') throw new Error('unreachable');

        const dataId = storeWorkflowScheduleSeed(built.seed);
        expect(dataId).not.toContain('Analyze');
        expect(readWorkflowScheduleSeed(dataId)?.name).toBe('Release check');
    });

    it('is single-use, so a stale back-navigation cannot silently reschedule', () => {
        const built = buildWorkflowScheduleSeed({ draft: draft(), saved: null, project: PROJECT });
        if (built.kind !== 'available') throw new Error('unreachable');
        const dataId = storeWorkflowScheduleSeed(built.seed);

        expect(readWorkflowScheduleSeed(dataId)).not.toBeNull();
        expect(readWorkflowScheduleSeed(dataId)).toBeNull();
    });

    it('returns null for an unknown or malformed seed rather than a partial one', () => {
        expect(readWorkflowScheduleSeed('missing-key')).toBeNull();
    });
});
