import { describe, expect, it } from 'vitest';

import { resolveRoutineServerSelectionScope } from './serverSelectionScope';

describe('resolveRoutineServerSelectionScope', () => {
    it('keeps routine web selection in the current tab', () => {
        expect(resolveRoutineServerSelectionScope('web')).toBe('tab');
    });

    it('uses device scope for a web renderer hosted by the desktop app', () => {
        expect(resolveRoutineServerSelectionScope('web', true)).toBe('device');
    });

    it.each(['ios', 'android', 'macos', 'windows'])('uses device scope for %s', (platformOS) => {
        expect(resolveRoutineServerSelectionScope(platformOS)).toBe('device');
    });
});
