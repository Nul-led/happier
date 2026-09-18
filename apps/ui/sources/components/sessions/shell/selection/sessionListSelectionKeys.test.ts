import { describe, expect, it } from 'vitest';

import { buildVisibleSessionNavigationEntries } from '@/sync/domains/session/navigation/sessionNavigationOrder';

import {
    buildSessionListSelectionKey,
    buildSessionListSelectionScopeKey,
    buildSessionListSelectionScopeKeyForView,
    readSessionListSelectionKeysFromVisibleEntries,
} from './sessionListSelectionKeys';
import { createSessionListViewFilterDefaults } from '../search/sessionListViewFilters';

describe('sessionListSelectionKeys', () => {
    it('uses server-scoped session keys so duplicate session ids do not collide', () => {
        expect(buildSessionListSelectionKey({ sessionId: 'alpha', serverId: 'server-a' }))
            .toBe(JSON.stringify(['server-a', 'alpha']));
        expect(buildSessionListSelectionKey({ sessionId: 'alpha', serverId: 'server-b' }))
            .toBe(JSON.stringify(['server-b', 'alpha']));
        expect(buildSessionListSelectionKey({ sessionId: 'alpha', serverId: null })).toBe('alpha');
    });

    it('reads visible selection keys from session-only navigation entries', () => {
        const visibleEntries = buildVisibleSessionNavigationEntries([
            { type: 'header' },
            { type: 'session', serverId: 'server-a', sessionId: 'alpha' },
            { type: 'header' },
            { type: 'session', serverId: 'server-a', sessionId: 'beta' },
        ]);

        expect(readSessionListSelectionKeysFromVisibleEntries(visibleEntries)).toEqual([
            JSON.stringify(['server-a', 'alpha']),
            JSON.stringify(['server-a', 'beta']),
        ]);
    });

    it('changes selection scope with the canonical semantic query identity', () => {
        const base = {
            filters: createSessionListViewFilterDefaults({
                scope: 'my_work',
                attention: 'any',
                source: 'all',
                homeServerIds: ['server-a', 'server-b'],
                audiences: [{ serverId: 'server-a', kind: 'team', teamId: 'team-a' }],
                tagIds: [{ serverId: 'server-a', tagId: 'urgent' }],
            }),
            eligibility: {
                eligibleHomeServerIds: ['server-a', 'server-b'],
                eligibleAudiences: [{ serverId: 'server-a', kind: 'team' as const, teamId: 'team-a' }],
                eligibleTagIds: [{ serverId: 'server-a', tagId: 'urgent' }],
            },
            storageKind: 'active',
            focusedFolderId: null,
            includeInactive: true,
        };

        const initial = buildSessionListSelectionScopeKeyForView(base);
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, scope: 'assigned_to_me' },
        }));
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, attention: 'needs_my_attention' },
        }));
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, source: 'direct' },
        }));
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, homeServerIds: ['server-a'] },
        }));
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, audiences: [] },
        }));
        expect(initial).not.toBe(buildSessionListSelectionScopeKeyForView({
            ...base,
            filters: { ...base.filters, tagIds: [] },
        }));
    });

    it('keeps presentation narrowing outside the canonical filter signature', () => {
        const left = buildSessionListSelectionScopeKey({
            storageKind: 'active',
            filterSignature: 'semantic-query',
            focusedFolderId: 'folder-a',
            includeInactive: false,
        });
        const right = buildSessionListSelectionScopeKey({
            storageKind: 'active',
            filterSignature: 'semantic-query',
            focusedFolderId: 'folder-a',
            includeInactive: false,
        });

        expect(left).toBe(right);
        expect(left).toContain('folder-a');
        expect(left).not.toBe(buildSessionListSelectionScopeKey({
            storageKind: 'archived',
            filterSignature: 'semantic-query',
            focusedFolderId: 'folder-a',
            includeInactive: false,
        }));
        expect(left).not.toBe(buildSessionListSelectionScopeKey({
            storageKind: 'active',
            filterSignature: 'semantic-query',
            focusedFolderId: 'folder-b',
            includeInactive: false,
        }));
        expect(left).not.toBe(buildSessionListSelectionScopeKey({
            storageKind: 'active',
            filterSignature: 'semantic-query',
            focusedFolderId: 'folder-a',
            includeInactive: true,
        }));
    });
});
