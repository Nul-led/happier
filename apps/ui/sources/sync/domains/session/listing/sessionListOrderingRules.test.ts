import { describe, expect, it } from 'vitest';

import {
    readSessionListUpdatedOrderingKey,
    resolveEffectiveSessionListOrderingModeForGroup,
    SESSION_LIST_UPDATED_ORDERING_BUCKET_MS,
} from './sessionListOrderingRules';

describe('readSessionListUpdatedOrderingKey', () => {
    it('falls back to the default bucket size when the provided bucket size truncates below one millisecond', () => {
        expect(readSessionListUpdatedOrderingKey({ createdAt: 100_000, meaningfulActivityAt: 650_000 }, 0.5)).toEqual({
            bucket: Math.floor(650_000 / SESSION_LIST_UPDATED_ORDERING_BUCKET_MS),
            createdAtSecondary: 100_000,
        });
    });
});

describe('resolveEffectiveSessionListOrderingModeForGroup', () => {
    it('always orders date groups by meaningful activity', () => {
        expect(resolveEffectiveSessionListOrderingModeForGroup({
            groupKind: 'date',
            userOrderingMode: 'custom',
        })).toBe('updated');
        expect(resolveEffectiveSessionListOrderingModeForGroup({
            groupKind: 'date',
            userOrderingMode: 'created',
        })).toBe('updated');
        expect(resolveEffectiveSessionListOrderingModeForGroup({
            groupKind: 'project',
            userOrderingMode: 'custom',
        })).toBe('custom');
    });
});
