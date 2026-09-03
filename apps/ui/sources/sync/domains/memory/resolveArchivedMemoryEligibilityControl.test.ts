import { describe, expect, it } from 'vitest';

import type { MemoryStatusV1 } from '@happier-dev/protocol';

import { resolveArchivedMemoryEligibilityControl } from './resolveArchivedMemoryEligibilityControl';

function status(extra: Partial<MemoryStatusV1>): MemoryStatusV1 {
    return { v: 1, enabled: true, indexMode: 'hints', ...extra } as MemoryStatusV1;
}

describe('resolveArchivedMemoryEligibilityControl', () => {
    it('treats an absent effective advertisement as unsupported and never claims the desired value applies', () => {
        const control = resolveArchivedMemoryEligibilityControl({
            status: status({}),
            desiredIncludeArchivedSessions: true,
        });

        expect(control).toEqual({ supported: false, value: false });
    });

    it('treats a missing status as unsupported', () => {
        expect(resolveArchivedMemoryEligibilityControl({
            status: null,
            desiredIncludeArchivedSessions: true,
        })).toEqual({ supported: false, value: false });
    });

    it('shows the effective value the daemon actually applies rather than the desired setting', () => {
        expect(resolveArchivedMemoryEligibilityControl({
            status: status({ includeArchivedSessionsEffective: false }),
            desiredIncludeArchivedSessions: true,
        })).toEqual({ supported: true, value: false });

        expect(resolveArchivedMemoryEligibilityControl({
            status: status({ includeArchivedSessionsEffective: true }),
            desiredIncludeArchivedSessions: false,
        })).toEqual({ supported: true, value: true });
    });
});
