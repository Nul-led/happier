import { describe, expect, it } from 'vitest';

import { buildSessionListRetentionKey } from './sessionListRetentionKey';

describe('buildSessionListRetentionKey', () => {
    it('includes the incumbent Account/list-source identity alongside storage kind', () => {
        expect(buildSessionListRetentionKey('archived', 'account-a:list-source-a'))
            .not.toBe(buildSessionListRetentionKey('archived', 'account-b:list-source-a'));
        expect(buildSessionListRetentionKey('archived', 'account-a:list-source-a'))
            .not.toBe(buildSessionListRetentionKey('archived', 'account-a:list-source-b'));
    });
});
