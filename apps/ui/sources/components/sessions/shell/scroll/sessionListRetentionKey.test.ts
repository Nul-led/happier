import { describe, expect, it } from 'vitest';

import { buildSessionListRetentionKey } from './sessionListRetentionKey';

describe('buildSessionListRetentionKey', () => {
    it('includes the incumbent Account/list-source identity alongside storage kind', () => {
        expect(buildSessionListRetentionKey('persisted', 'account-a:archived'))
            .not.toBe(buildSessionListRetentionKey('persisted', 'account-b:archived'));
        expect(buildSessionListRetentionKey('persisted', 'account-a:archived'))
            .not.toBe(buildSessionListRetentionKey('persisted', 'account-a:active'));
    });
});
