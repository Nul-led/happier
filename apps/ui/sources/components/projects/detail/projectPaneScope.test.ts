import { describe, expect, it } from 'vitest';
import { buildProjectPaneScopeId } from './projectPaneScope';

describe('project pane scope', () => {
    it('isolates duplicate destination panes while retaining the native scope when no instance is supplied', () => {
        expect(buildProjectPaneScopeId('project-a')).toBe('project:project-a');
        expect(buildProjectPaneScopeId('project-a', 'tab:a')).not.toBe(buildProjectPaneScopeId('project-a', 'tab:b'));
        expect(buildProjectPaneScopeId('project-a', 'tab:a')).not.toBe(buildProjectPaneScopeId('project-a'));
    });
});
