import { describe, expect, it } from 'vitest';

import { prepareRunnerMcpMaterial, RunnerMcpMaterializationUnavailableError } from './prepareRunnerMcpMaterial';

const settings = {
    v: 1,
    strictMode: true,
    servers: [{
        id: 'server-a', name: 'server-a', transport: 'http',
        remote: { url: 'https://mcp.example.test', headers: { Authorization: { t: 'savedSecret', secretId: 'secret-a' } } },
        env: {}, createdAt: 1, updatedAt: 2,
    }],
    bindings: [{ id: 'all', serverId: 'server-a', enabled: true, target: { t: 'allMachines' }, createdAt: 3, updatedAt: 4 }],
} as const;

describe('prepareRunnerMcpMaterial', () => {
    it('keeps the ordinary no-settings path empty', () => {
        expect(prepareRunnerMcpMaterial({
            settingsLike: undefined,
            selection: null,
            secrets: [],
            decryptSecretValue: () => null,
        })).toBeNull();
    });

    it('resolves only selected saved-secret material into the sealed Runner payload', () => {
        expect(prepareRunnerMcpMaterial({
            settingsLike: settings,
            selection: { v: 1, managedServersEnabled: true, forceIncludeServerIds: [], forceExcludeServerIds: [] },
            secrets: [{ id: 'secret-a', name: 'MCP token', kind: 'token', encryptedValue: { _isSecretValue: true, encryptedValue: { t: 'enc-v1', c: 'ciphertext' } }, createdAt: 1, updatedAt: 2 }],
            decryptSecretValue: () => 'Bearer creator-resolved',
        })?.servers[0]).toMatchObject({
            savedSecretRevisions: [{ secretId: 'secret-a', revision: 2 }],
            config: { remote: { headers: { Authorization: { t: 'literal', v: 'Bearer creator-resolved' } } } },
        });
    });

    it('returns the exact source-specific preactivation refusal', () => {
        expect(() => prepareRunnerMcpMaterial({
            settingsLike: settings,
            selection: null,
            secrets: [],
            decryptSecretValue: () => null,
        })).toThrowError(expect.objectContaining({
            name: 'RunnerMcpMaterializationUnavailableError',
            failure: { ok: false, reason: 'saved_secret_unavailable', serverId: 'server-a', valuePath: 'header:Authorization' },
        }) satisfies Partial<RunnerMcpMaterializationUnavailableError>);
    });
});
