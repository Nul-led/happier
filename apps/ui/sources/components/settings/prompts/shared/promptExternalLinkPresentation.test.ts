import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import { describePromptExternalLinkSubtitle } from './promptExternalLinkPresentation';

describe('describePromptExternalLinkSubtitle', () => {
    it('avoids leaking technical asset type ids into the user-facing subtitle', () => {
        const subtitle = describePromptExternalLinkSubtitle({
            link: {
                id: 'link-1',
                artifactId: 'artifact-1',
                assetTypeId: 'claude.command',
                machineId: 'machine-1',
                scope: 'project',
                workspacePath: '/repo/project',
                externalRef: { relativePath: 'review/code.md' },
            },
            machines: [{ id: 'machine-1', metadata: { displayName: 'Laptop' } }],
            scopeLabel: 'Project',
        });

        expect(subtitle).toBe('Laptop · Project · /repo/project');
        expect(subtitle).not.toContain('claude.command');
    });

    it('names an unnamed machine as unnamed, never by its id', () => {
        const subtitle = describePromptExternalLinkSubtitle({
            link: {
                id: 'link-1',
                artifactId: 'artifact-1',
                assetTypeId: 'claude.command',
                machineId: 'f98b860d-63e0',
                scope: 'project',
                workspacePath: '/repo',
                externalRef: { relativePath: 'review/code.md' },
            },
            machines: [{ id: 'f98b860d-63e0', metadata: {} }],
            scopeLabel: 'Project',
        });
        expect(subtitle.startsWith(t('machine.unnamedMachine'))).toBe(true);
        expect(subtitle).not.toContain('f98b860d');
    });
});
