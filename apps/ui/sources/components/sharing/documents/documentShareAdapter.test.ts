import { describe, expect, it } from 'vitest';

import { createDocumentShareAdapter } from './documentShareAdapter';

const base = { artifactId: 'document', grants: [], loading: false, readOnly: false, retryContent: () => {} };

describe('createDocumentShareAdapter', () => {
    it('gives every ordinary Artifact kind its own recipient meaning, not only workflows, roles and profiles', () => {
        const levels = (kind: string | null) => createDocumentShareAdapter({ ...base, kind }).levels;
        const workflow = levels('workflow-definition.v1');
        for (const kind of [null, 'prompt_doc.v2', 'work-board.v1', 'published.v1']) {
            const view = levels(kind).view;
            expect(view.help, String(kind)).toEqual(expect.any(String));
            expect(view.help).not.toBe(workflow.view.help);
        }
        // A document is read, not "used": its level reads as such, while a workflow keeps "Can use".
        expect(levels(null).view.label).not.toBe(workflow.view.label);
        expect(levels('prompt_doc.v2').view.label).toBe(workflow.view.label);
        // Every kind keeps the same edit and admin meaning.
        expect(levels('work-board.v1').edit).toEqual(workflow.edit);
    });
});
