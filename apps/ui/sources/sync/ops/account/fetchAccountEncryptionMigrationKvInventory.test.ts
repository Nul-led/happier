import { describe, expect, it, vi } from 'vitest';
import { fetchAccountEncryptionMigrationKvInventory } from './fetchAccountEncryptionMigrationKvInventory';

describe('Account encryption migration KV inventory', () => {
    const scope = { scope: { serverId: 'home', accountId: 'account' }, isCurrent: () => true };
    it.each(['todo', 'workspace'] as const)('reads the exact complete %s inventory beyond the existing list page boundary', async namespace => {
        const prefix = namespace === 'todo' ? 'todo.' : 'workspace:';
        const rows = Array.from({ length: 1001 }, (_, index) => ({ key: `${prefix}${String(index).padStart(4, '0')}`, value: 'record', version: index }));
        const request = vi.fn(async (path: string) => {
            const query = new URL(path, 'https://home').searchParams;
            const afterKey = query.get('afterKey');
            return Response.json({ items: rows.filter(row => !afterKey || row.key > afterKey).slice(0, Number(query.get('limit'))) });
        });
        const inventory = await fetchAccountEncryptionMigrationKvInventory({ namespace, credentials: { token: 'captured' }, request, scope });
        expect(inventory).toHaveLength(rows.length);
        expect(inventory).toEqual(rows);
    });
    it('refuses an old server that ignores the cursor before claiming complete migration inventory', async () => {
        const rows = Array.from({ length: 1000 }, (_, index) => ({ key: `workspace:${String(index).padStart(4, '0')}`, value: 'record', version: 2 }));
        const request = vi.fn(async () => Response.json({ items: rows }));
        const error = await fetchAccountEncryptionMigrationKvInventory({ namespace: 'workspace', credentials: { token: 'captured' }, request, scope }).then(() => null, error => error);
        expect(error).toMatchObject({ code: 'account_encryption_migration_kv_inventory_unavailable' });
    });
    it('retires the captured Account scope while a page is pending without reading another page', async () => {
        let current = true;
        const request = vi.fn(async () => {
            current = false;
            return Response.json({ items: [] });
        });
        await expect(fetchAccountEncryptionMigrationKvInventory({ namespace: 'workspace', credentials: { token: 'captured' }, request, scope: { ...scope, isCurrent: () => current } })).rejects.toThrow();
        expect(request).toHaveBeenCalledTimes(1);
    });
});
