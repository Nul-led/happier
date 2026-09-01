import { describe, expect, it } from 'vitest';

import { workspaceSyncDiagnosticTranslations } from './workspaceSyncDiagnosticTranslations';

describe('workspaceSyncDiagnosticTranslations', () => {
    it('localizes diagnostic and unsafe-resolution copy for every non-English locale', () => {
        const locales = Object.values(workspaceSyncDiagnosticTranslations);
        expect(locales).toHaveLength(11);
        for (const locale of locales) {
            expect(locale.diagnostics.title).not.toBe('Diagnostics');
            expect(locale.diagnostics.relationshipId).not.toBe('Relationship ID');
            expect(locale.resolve.unverifiedFile).not.toContain('current file fingerprint');
        }
    });
});
