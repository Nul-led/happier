import { describe, expect, it } from 'vitest';
import { createMachineAgentInventoryPersistence } from './machineAgentInventoryPersistence';

describe('machine agent last-known persistence', () => {
    it('recovers an exact account/machine snapshot and fails closed on foreign scope or malformed rows', () => {
        // Device storage is the genuine persistent boundary; the projection and parser remain real.
        const values = new Map<string, string>();
        const persistence = createMachineAgentInventoryPersistence({ getString: (key) => values.get(key), set: (key, value) => { values.set(key, value); } });
        const scope = { serverId: 'home', accountId: 'alice' };
        const snapshot = { items: [], lastCheckedAt: 123 };
        persistence.write(scope, 'machine', snapshot);
        expect(persistence.read(scope, 'machine')).toEqual(snapshot);
        expect(persistence.read({ ...scope, accountId: 'bob' }, 'machine')).toBeNull();
        expect(persistence.read(scope, 'other')).toBeNull();
        for (const key of values.keys()) values.set(key, JSON.stringify({ ...snapshot, items: [{ installed: true }] }));
        expect(persistence.read(scope, 'machine')).toBeNull();
    });
});
