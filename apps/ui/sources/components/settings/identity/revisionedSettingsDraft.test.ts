import { describe, expect, it } from 'vitest';

import { revisionedSettingsDraftTransition } from './revisionedSettingsDraft';

describe('revisioned settings draft continuity', () => {
    const current = { resourceId: 'resource-1', revision: 4 };

    it('adopts a first or different resource', () => {
        expect(revisionedSettingsDraftTransition({ origin: null, current, dirty: true })).toBe('adopt');
        expect(revisionedSettingsDraftTransition({
            origin: { resourceId: 'resource-2', revision: 9 },
            current,
            dirty: true,
        })).toBe('adopt');
    });

    it('keeps the editor at the same or a newer already-observed revision', () => {
        expect(revisionedSettingsDraftTransition({
            origin: { resourceId: 'resource-1', revision: 4 },
            current,
            dirty: true,
        })).toBe('keep');
        expect(revisionedSettingsDraftTransition({
            origin: { resourceId: 'resource-1', revision: 5 },
            current,
            dirty: false,
        })).toBe('keep');
    });

    it('preserves a dirty draft when the resource advances and quietly adopts when clean', () => {
        expect(revisionedSettingsDraftTransition({
            origin: { resourceId: 'resource-1', revision: 3 },
            current,
            dirty: true,
        })).toBe('conflict');
        expect(revisionedSettingsDraftTransition({
            origin: { resourceId: 'resource-1', revision: 3 },
            current,
            dirty: false,
        })).toBe('adopt');
    });
});
