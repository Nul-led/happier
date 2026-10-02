import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { writeExecutableShimSync } from '@/testkit/fs/executableShim';

import { projectAgentProviderCliAttachCatalogEntry } from './agentCatalogEntryHooks';
import { buildOpenCodeAgentRuntimeDescriptorV1 } from '../../../../../../packages/plugins/opencode/src/agent/identity/runtimeDescriptor';
import {
    createOpenCodeAttachArgs,
    resolveOpenCodeAttachReachability,
    resolveOpenCodeAttachTarget,
} from '../../../../../../packages/plugins/opencode/src/agent/surfaces/sessions/attach/descriptor';

describe('Agent provider CLI attach catalog projection', () => {
    it.each([true, false])('preserves declared managed access without a host resolver (declared=%s)', async (declared) => {
        const root = await mkdtemp(join(tmpdir(), 'happier-provider-attach-missing-access-'));
        const log = join(root, 'child.log');
        const executable = writeExecutableShimSync({
            dir: root, fileName: process.platform === 'win32' ? 'attach.cmd' : 'attach',
            contents: process.platform === 'win32'
                ? `@echo off\necho attached>>"${log}"`
                : `#!/bin/sh\nprintf attached > '${log}'`,
        });
        const http = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', http);
        const hooks = projectAgentProviderCliAttachCatalogEntry({
            agentId: 'opencode', pluginId: 'happier.agent.opencode', localAgentId: 'opencode',
            systemTools: [{ id: 'fixture-attach', title: 'Attach fixture', executableNames: [executable] }],
            providerCliAttach: {
                commandToolIds: ['fixture-attach'], resolveCommandToolId: () => 'fixture-attach',
                resolveTarget: resolveOpenCodeAttachTarget, createArgs: createOpenCodeAttachArgs,
                resolveReachability: resolveOpenCodeAttachReachability,
                ...(declared ? { managedServiceAccess: {
                    credentialEnvironmentKey: 'OPENCODE_SERVER_PASSWORD',
                    resolveTargetBaseUrl: (target: { baseUrl?: string }) => target.baseUrl ?? null,
                } } : {}),
            },
        });
        const metadata = { path: '/repo', runtimeDescriptorV1: buildOpenCodeAgentRuntimeDescriptorV1({
            backendMode: 'server', providerSessionId: 'ses-exact-parent',
            serverBaseUrl: 'http://127.0.0.1:4096', serverBaseUrlExplicit: true,
        }) };
        try {
            const attach = (await hooks.resolveHostAgentRuntimeSurfaces?.())?.attach;
            const availability = await attach?.evaluateAvailability?.({
                operation: 'attach', sessionId: 'session-one', metadata, depth: 'live', hasLocalAttachmentInfo: true,
            });
            expect(availability?.available).toBe(!declared);
            const result = await attach?.attach({ sessionId: 'session-one', metadata });
            expect(result?.ok).toBe(!declared);
            expect(existsSync(log)).toBe(!declared);
            expect(http.mock.calls.length).toBe(declared ? 0 : 1);
        } finally {
            vi.unstubAllGlobals();
            await rm(root, { recursive: true, force: true });
        }
    });

    it('uses the settings-selected declared tool for both version probing and attach spawn', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-provider-attach-tool-selection-'));
        const stableLog = join(root, 'stable.log');
        const v2Log = join(root, 'v2.log');
        const stable = writeExecutableShimSync({
            dir: root,
            fileName: process.platform === 'win32' ? 'opencode-stable.cmd' : 'opencode-stable',
            contents: process.platform === 'win32'
                ? `@echo off\necho stable:%*>>"${stableLog}"\nif "%1"=="--version" echo 1.18.25`
                : `#!/bin/sh\nprintf 'stable:%s\\n' "$*" >> '${stableLog}'\nif [ "$1" = "--version" ]; then printf 1.18.25; fi`,
        });
        const v2 = writeExecutableShimSync({
            dir: root,
            fileName: process.platform === 'win32' ? 'opencode-v2.cmd' : 'opencode-v2',
            contents: process.platform === 'win32'
                ? `@echo off\necho v2:%*:%EXACT_SERVER_PASSWORD%:%CANONICAL_PASSWORD%>>"${v2Log}"\nif "%1"=="--version" echo 2.0.15`
                : `#!/bin/sh\nprintf 'v2:%s:%s:%s\\n' "$*" "$EXACT_SERVER_PASSWORD" "$CANONICAL_PASSWORD" >> '${v2Log}'\nif [ "$1" = "--version" ]; then printf 2.0.15; fi`,
        });
        const resolveManagedServiceSessionClientAccess = vi.fn(async () => ({
            baseUrl: 'http://127.0.0.1:4096/',
            request: async () => ({ ok: true }),
            childEnvironment: Object.freeze({
                EXACT_SERVER_PASSWORD: 'exact-host-owned-password',
            }),
        }));
        const hooks = projectAgentProviderCliAttachCatalogEntry({
            agentId: 'opencode',
            pluginId: 'happier.agent.opencode',
            localAgentId: 'opencode',
            resolveManagedServiceSessionClientAccess,
            resolvePluginSettings: async () => ({ account: { opencodeCliGeneration: 'v2' } }),
            systemTools: [
                { id: 'opencode-cli-stable', title: 'Stable', executableNames: [stable] },
                { id: 'opencode-cli-v2', title: 'V2', executableNames: [v2] },
            ],
            providerCliAttach: {
                commandToolIds: ['opencode-cli-stable', 'opencode-cli-v2'],
                resolveCommandToolId: ({ accountSettings }) => (
                    accountSettings?.opencodeCliGeneration === 'v2'
                        ? 'opencode-cli-v2'
                        : 'opencode-cli-stable'
                ),
                cliVersionArgs: ['--version'],
                managedServiceAccess: {
                    credentialEnvironmentKey: 'EXACT_SERVER_PASSWORD',
                    credentialEnvironmentAliases: ['CANONICAL_PASSWORD'],
                    resolveTargetBaseUrl: (target) => target.baseUrl ?? null,
                },
                resolveTarget: () => ({
                    ok: true,
                    value: { baseUrl: 'http://127.0.0.1:4096/' },
                }),
                createArgs: (_target, host) => ['attach', `--observed-version=${host.cliVersion ?? ''}`],
                resolveReachability: () => null,
            },
        });

        try {
            const attach = (await hooks.resolveHostAgentRuntimeSurfaces?.())?.attach;
            await expect(attach?.attach({ sessionId: 'session-v2', metadata: {} }))
                .resolves.toEqual({ ok: true, value: { exitCode: 0 } });
            expect(readFileSync(v2Log, 'utf8')).toBe(
                'v2:--version:exact-host-owned-password:exact-host-owned-password\n'
                + 'v2:attach --observed-version=2.0.15:exact-host-owned-password:exact-host-owned-password\n',
            );
            expect(existsSync(stableLog)).toBe(false);
            expect(resolveManagedServiceSessionClientAccess).toHaveBeenCalledWith({
                pluginId: 'happier.agent.opencode',
                sessionId: 'session-v2',
                contributionId: 'happier.agent.opencode/agents/opencode',
                targetBaseUrl: 'http://127.0.0.1:4096/',
                environmentKey: 'EXACT_SERVER_PASSWORD',
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('binds the host fallback reader to the exact plugin contribution and Session', async () => {
        const resolveManagedServiceSessionBaseUrl = vi.fn(async () => (
            'http://127.0.0.1:49197'
        ));
        const hooks = projectAgentProviderCliAttachCatalogEntry({
            agentId: 'opencode',
            pluginId: 'happier.agent.opencode',
            localAgentId: 'opencode',
            resolveManagedServiceSessionBaseUrl,
            providerCliAttach: {
                resolveTarget: ({ fallbackServerBaseUrl }) => {
                    const baseUrl = fallbackServerBaseUrl;
                    return baseUrl
                        ? { ok: true, value: { baseUrl } }
                        : { ok: false, reason: 'missing server URL' };
                },
                createArgs: (target) => ['attach', target.baseUrl],
                resolveReachability: () => null,
            },
        });
        const attach = (await hooks.resolveHostAgentRuntimeSurfaces?.())?.attach;

        await expect(attach?.evaluateAvailability?.({
            operation: 'attach',
            sessionId: 'happier-session',
            metadata: {},
            depth: 'metadata',
            hasLocalAttachmentInfo: true,
        })).resolves.toEqual({ available: true });
        expect(resolveManagedServiceSessionBaseUrl).toHaveBeenCalledWith({
            pluginId: 'happier.agent.opencode',
            sessionId: 'happier-session',
            contributionId: 'happier.agent.opencode/agents/opencode',
        });
    });
});
