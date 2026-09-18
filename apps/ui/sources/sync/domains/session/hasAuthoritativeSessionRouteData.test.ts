import { describe, expect, it } from 'vitest';

import { hasAuthoritativeSessionRouteData } from './hasAuthoritativeSessionRouteData';
import type { NormalizedSessionAccessProjection } from '@/sync/engine/sessions/normalizeSessionAccessProjection';

describe('hasAuthoritativeSessionRouteData', () => {
    it('keeps layout-0 metadata presence as the hydration contract', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadata: { path: '/legacy/repo' },
        })).toBe(true);
        expect(hasAuthoritativeSessionRouteData({
            metadata: null,
        })).toBe(false);
    });

    it('requires the layout-1 owner compatibility view instead of shared metadata alone', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            metadata: {
                v: 1,
                summary: { text: 'Shared title', updatedAt: 1 },
            },
            ownerMetadataView: null,
        })).toBe(false);
    });

    it('accepts a layout-1 participant from the strict shared projection without owner data', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            accessLevel: 'view',
            metadata: {
                v: 1,
                summary: { text: 'Shared title', updatedAt: 1 },
            },
            ownerMetadataView: null,
        })).toBe(true);
    });

    it('uses the normalized effective-access role for current Team-only rows', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            access: { role: 'recipient', level: 'view', capabilities: {} as NormalizedSessionAccessProjection['capabilities'] },
            metadata: { v: 1, summary: { text: 'Shared title', updatedAt: 1 } },
            ownerMetadataView: null,
        })).toBe(true);
    });

    it('rejects malformed layout-1 participant metadata instead of treating any object as authoritative', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            accessLevel: 'view',
            metadata: {
                v: 1,
                path: '/injected/private/path',
            },
            ownerMetadataView: null,
        })).toBe(false);
    });

    it('fails closed when the current access projection is explicitly unavailable', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            access: null,
            metadata: { v: 1, summary: { text: 'Shared title', updatedAt: 1 } },
            ownerMetadataView: { path: '/must-not-open', machineId: 'owner-machine' },
        })).toBe(false);
    });

    it('accepts layout-1 route data after the owner compatibility view is hydrated', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 1,
            metadata: {
                v: 1,
                summary: { text: 'Shared title', updatedAt: 1 },
            },
            ownerMetadataView: {
                path: '/owner/repo',
                machineId: 'owner-machine',
            },
        })).toBe(true);
    });

    it('fails closed for unsupported future layouts', () => {
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: 2,
            metadata: { path: '/future/repo' },
            ownerMetadataView: { path: '/future/owner/repo' },
        })).toBe(false);
        expect(hasAuthoritativeSessionRouteData({
            metadataLayoutVersion: null as never,
            metadata: { path: '/must-not-become-legacy' },
            ownerMetadataView: { path: '/must-not-become-owner' },
        })).toBe(false);
    });
});
