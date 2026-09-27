import { describe, expect, it } from 'vitest';

import {
    applyAcpBackendDeleteV1,
    applyAcpBackendUpsertV1,
    normalizeAcpCatalogSettingsV1,
    suggestAcpBackendIdV1,
} from './catalogMutationsV1.js';

const existing = {
    id: 'backend-1',
    name: 'backend-1',
    title: 'Backend 1',
    command: 'kiro-cli',
    args: ['acp'],
    env: {},
    capabilities: {
        supportsLoadSession: true,
        supportsModes: 'yes' as const,
        supportsModels: 'yes' as const,
        supportsConfigOptions: 'unknown' as const,
        promptImageSupport: 'yes' as const,
    },
    createdAt: 1,
    updatedAt: 1,
};
const stored = { v: 2 as const, backends: [existing] };

describe('ACP catalog mutations', () => {
    it('normalizes the stored catalog, falling back to an empty catalog for an unreadable value', () => {
        expect(normalizeAcpCatalogSettingsV1(stored)).toEqual(stored);
        expect(normalizeAcpCatalogSettingsV1('garbage')).toEqual({ v: 2, backends: [] });
        expect(normalizeAcpCatalogSettingsV1({ v: 2, backends: [{ id: 'Bad Id' }] })).toEqual({ v: 2, backends: [] });
    });

    it('trims an authored backend, stamps a new one and appends it', () => {
        const result = applyAcpBackendUpsertV1({
            settings: stored,
            backend: { id: ' backend-2 ', name: ' backend-2 ', title: ' Backend 2 ', command: ' custom-cli ', args: ['acp'], description: '  ' },
            nowMs: 50,
        });

        expect(result).toEqual({
            ok: true,
            backend: expect.objectContaining({ id: 'backend-2', name: 'backend-2', title: 'Backend 2', command: 'custom-cli', createdAt: 50, updatedAt: 50 }),
            settings: { v: 2, backends: [existing, expect.objectContaining({ id: 'backend-2' })] },
        });
        if (!result.ok) throw new Error('expected ok');
        expect(result.backend.description).toBeUndefined();
    });

    it('replaces an existing backend in place and keeps its creation time', () => {
        const result = applyAcpBackendUpsertV1({
            settings: stored,
            backend: { id: 'backend-1', name: 'backend-1', title: 'Renamed', command: 'kiro-cli' },
            nowMs: 99,
        });
        if (!result.ok) throw new Error('expected ok');
        expect(result.settings.backends).toHaveLength(1);
        expect(result.backend).toMatchObject({ title: 'Renamed', createdAt: 1, updatedAt: 99 });
    });

    it('keeps timestamps an author already set (the editor draft carries its own)', () => {
        const result = applyAcpBackendUpsertV1({
            settings: { v: 2, backends: [] },
            backend: { ...existing, createdAt: 7, updatedAt: 8 },
            nowMs: 99,
        });
        if (!result.ok) throw new Error('expected ok');
        expect(result.backend).toMatchObject({ createdAt: 7, updatedAt: 8 });
    });

    it('rejects an invalid backend and a duplicate name with typed codes', () => {
        expect(applyAcpBackendUpsertV1({ settings: stored, backend: { id: 'Bad Id', name: 'x', title: 't', command: 'c' }, nowMs: 1 }))
            .toMatchObject({ ok: false, code: 'acp_backend_invalid' });
        expect(applyAcpBackendUpsertV1({ settings: stored, backend: { id: 'backend-3', name: 'backend-1', title: 't', command: 'c' }, nowMs: 1 }))
            .toEqual({ ok: false, code: 'acp_backend_name_conflict', message: 'Duplicate ACP backend name: backend-1', fields: ['name'] });
    });

    it('names every invalid field so an editor can show each error beside its field', () => {
        const result = applyAcpBackendUpsertV1({
            settings: stored,
            backend: {
                id: 'Bad Id', name: 'bad-id', title: ' ', command: '',
                env: { 'lower-case': { t: 'literal', v: 'x' } },
                auth: { support: 'login_terminal', docsUrl: 'not a url' },
            },
            nowMs: 1,
        });
        expect(result).toMatchObject({ ok: false, code: 'acp_backend_invalid' });
        if (result.ok) throw new Error('expected a refusal');
        expect([...result.fields].sort()).toEqual(['auth.docsUrl', 'command', 'env', 'id', 'title']);
    });

    it('refuses to create a backend over an existing id instead of replacing it', () => {
        const created = applyAcpBackendUpsertV1({
            settings: stored,
            backend: { id: 'backend-1', name: 'another', title: 'Another', command: 'c' },
            nowMs: 1,
            mode: 'create',
        });
        expect(created).toMatchObject({ ok: false, code: 'acp_backend_id_conflict', fields: ['id'] });
        // Upsert (the action's default) still replaces by id.
        expect(applyAcpBackendUpsertV1({
            settings: stored,
            backend: { id: 'backend-1', name: 'backend-1', title: 'Again', command: 'c' },
            nowMs: 1,
        })).toMatchObject({ ok: true });
    });

    it('deletes by id and reports an unknown id', () => {
        expect(applyAcpBackendDeleteV1({ settings: stored, backendId: 'backend-1' })).toEqual({ ok: true, settings: { v: 2, backends: [] } });
        expect(applyAcpBackendDeleteV1({ settings: stored, backendId: 'missing' })).toEqual({ ok: false, code: 'acp_backend_not_found' });
    });
});

describe('suggestAcpBackendIdV1', () => {
    it('derives a valid id from a display name', () => {
        expect(suggestAcpBackendIdV1({ title: 'My Kiro Agent!', settings: { v: 2, backends: [] } })).toBe('my-kiro-agent');
        expect(suggestAcpBackendIdV1({ title: '  Élan_2.0  ', settings: { v: 2, backends: [] } })).toBe('elan_2.0');
    });

    it('avoids ids and names already in the catalog', () => {
        expect(suggestAcpBackendIdV1({ title: 'Backend 1', settings: stored })).toBe('backend-1-2');
    });

    it('returns an empty id when the name has nothing to derive from', () => {
        expect(suggestAcpBackendIdV1({ title: '  ', settings: stored })).toBe('');
        expect(suggestAcpBackendIdV1({ title: '日本', settings: stored })).toBe('');
    });
});
