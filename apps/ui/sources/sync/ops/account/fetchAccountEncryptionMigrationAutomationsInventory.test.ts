import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountEncryptionMigrationAutomationsInventory } from './fetchAccountEncryptionMigrationAutomationsInventory';

describe('complete Automation encryption migration inventory', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('reads the complete current inventory without an older-server capability probe', async () => {
        // The captured request is the network boundary; no separate server probe may send credentials.
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const request = vi.fn(async () => Response.json({ templates: [], runs: [] }));
        await expect(fetchAccountEncryptionMigrationAutomationsInventory({ request })).resolves.toEqual({ templates: [], runs: [] });
        expect(request).toHaveBeenCalledWith('/v1/account/encryption/migrate/automations/inventory', { method: 'GET' }, { includeAuth: true, retry: 'none' });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([404, 403])('refuses a failed inventory operation (%s) without claiming an empty census', async (status) => {
        const request = async () => Response.json({ error: 'refused' }, { status });
        await expect(fetchAccountEncryptionMigrationAutomationsInventory({ request })).rejects.toThrow('automations_migration_inventory_fetch_failed');
    });
    it('refuses an incomplete census rather than fabricating absent runs', async () => {
        const request = async () => Response.json({ templates: [] });
        await expect(fetchAccountEncryptionMigrationAutomationsInventory({ request })).rejects.toThrow();
    });
});
