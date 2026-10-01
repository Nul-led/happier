import { describe, expect, it } from 'vitest';
import { resolveResumeFailurePresentation } from './resolveResumeFailurePresentation';

describe('session resume failure presentation', () => {
    it('offers explicit private-folder recovery instead of a modal failure', () => {
        expect(resolveResumeFailurePresentation({
            errorCode: 'SESSION_DIRECTORY_MISSING', errorMessage: 'Machine-private diagnostic path',
        }, 'Resume failed')).toEqual({ kind: 'directory_missing' });
    });

    it('keeps validation diagnostics out of generic resume alerts', () => {
        expect(resolveResumeFailurePresentation({
            errorCode: 'SPAWN_VALIDATION_FAILED', errorMessage: 'Private validation details',
        }, 'Resume failed')).toEqual({ kind: 'alert', message: 'Resume failed' });
    });
});
