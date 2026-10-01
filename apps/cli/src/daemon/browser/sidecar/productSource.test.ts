import { describe, expect, it, vi } from 'vitest';

import type { SidecarBrowserBinaryCandidate } from './binary';
import * as productSource from './productSource';

const MANAGED_PROVENANCE = {
    origin: 'managed_package' as const,
    pinnedVersion: '127.0.6533.88',
    channel: 'stable' as const,
    integrityDigest: `sha256:${'a'.repeat(64)}`,
    license: 'BSD-3-Clause',
};

function managedCandidate(): SidecarBrowserBinaryCandidate {
    return {
        source: 'managedBrowserPackage',
        executablePath: '/home/u/.happier/tools/browser-chromium/current/chrome',
        discoveryKind: 'managedRuntime',
        available: true,
        provenance: MANAGED_PROVENANCE,
    };
}

describe('browser sidecar product source owner', () => {
    it('fails closed with a typed blocker when no managed or packaged Browser executable is registered', async () => {
        const mod = await import('./productSource');

        expect(mod?.resolveProductBrowserSidecarBinary).toBeTypeOf('function');
        if (!mod?.resolveProductBrowserSidecarBinary) return;

        const result = mod.resolveProductBrowserSidecarBinary({
            platform: 'darwin',
            candidates: [],
        });

        expect(result).toMatchObject({
            ok: false,
            source: 'managedBrowserPackage',
            errorCode: 'managed_package_missing',
            disabledReason: 'No source-backed managed or packaged Browser sidecar executable is registered.',
        });
    });

    it('does not promote system browser candidates into the product sidecar source', async () => {
        const mod = await import('./productSource');

        expect(mod?.resolveProductBrowserSidecarBinary).toBeTypeOf('function');
        if (!mod?.resolveProductBrowserSidecarBinary) return;

        const result = mod.resolveProductBrowserSidecarBinary({
            platform: 'darwin',
            candidates: [{
                source: 'systemChrome',
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                discoveryKind: 'systemRegistry',
                available: true,
            }],
        });

        expect(result).toMatchObject({
            ok: false,
            source: 'managedBrowserPackage',
            errorCode: 'managed_package_missing',
        });
        expect(JSON.stringify(result)).not.toContain('Google Chrome');
    });

    it('narrows the product whitelist to managedBrowserPackage only (rejects CfT/Playwright/Electron)', async () => {
        const mod = await import('./productSource');

        expect(mod?.resolveProductBrowserSidecarBinary).toBeTypeOf('function');
        if (!mod?.resolveProductBrowserSidecarBinary) return;

        for (const source of ['chromeForTesting', 'playwrightChromium', 'electronChromium'] as const) {
            const result = mod.resolveProductBrowserSidecarBinary({
                platform: 'linux',
                candidates: [{
                    source,
                    executablePath: `/some/${source}/chrome`,
                    discoveryKind: 'managedRuntime',
                    available: true,
                }],
            });
            expect(result).toMatchObject({
                ok: false,
                source: 'managedBrowserPackage',
                errorCode: 'managed_package_missing',
            });
        }
    });

    it('accepts a managed candidate with verified provenance', () => {
        expect(productSource.resolveProductBrowserSidecarBinary({ platform: 'linux', candidates: [managedCandidate()] }))
            .toMatchObject({ ok: true, source: 'managedBrowserPackage', provenance: { origin: 'managed_package' } });
    });

    it('rejects a resolved but server-disabled source', async () => {
        const factory = productSource.createProductBrowserSidecarControlAdapterFactory({
            platform: 'linux',
            // Server-disabled `browser.sidecar` decision threaded from the daemon startup gate.
            featureEnabled: false,
            resolveManagedCandidate: vi.fn(async () => managedCandidate()),
        });
        expect(await factory({ machineId: 'machine_disabled' })).toMatchObject({ ok: false, errorCode: 'feature_disabled' });
    });

    it('stays fail-closed when no managed candidate is installed', async () => {
        const mod = await import('./productSource');

        expect(mod?.createProductBrowserSidecarControlAdapterFactory).toBeTypeOf('function');
        if (!mod?.createProductBrowserSidecarControlAdapterFactory) return;

        const factory = mod.createProductBrowserSidecarControlAdapterFactory({
            platform: 'linux',
            featureEnabled: true,
            resolveManagedCandidate: vi.fn(async () => null),
        });

        const result = await factory({ machineId: 'machine_missing' });

        expect(result).toMatchObject({ ok: false, errorCode: 'managed_package_missing' });
    });

    // MCH-2: lazy-install trigger — a supported, digest-pinned platform whose artifact is missing
    // (available:false) installs once, then re-resolves to the freshly-installed candidate.
    it('lazily installs the managed binary when missing then re-resolves and delegates to launch', async () => {
        const mod = await import('./productSource');

        expect(mod?.createProductBrowserSidecarControlAdapterFactory).toBeTypeOf('function');
        if (!mod?.createProductBrowserSidecarControlAdapterFactory) return;

        const missingThenInstalled = vi
            .fn()
            .mockResolvedValueOnce({
                source: 'managedBrowserPackage' as const,
                discoveryKind: 'managedRuntime' as const,
                available: false as const,
                disabledReason: 'not installed',
            })
            .mockResolvedValueOnce(managedCandidate());
        const installManagedBrowserChromium = vi.fn(async () => ({
            ok: true as const,
            executablePath: '/home/u/.happier/tools/browser-chromium/current/chrome',
            pinnedVersion: '127.0.6533.88',
            integrityDigest: `sha256:${'a'.repeat(64)}`,
        }));

        const factory = mod.createProductBrowserSidecarControlAdapterFactory({
            platform: 'linux',
            featureEnabled: true,
            resolveManagedCandidate: missingThenInstalled,
            installManagedBrowserChromium,
        });

        const result = await factory({ machineId: 'machine_lazy' });

        expect(installManagedBrowserChromium).toHaveBeenCalledOnce();
        expect(missingThenInstalled).toHaveBeenCalledTimes(2);
        expect(result.ok).toBe(true);
    });

    it('does not lazily install when autoInstallWhenMissing is disabled', async () => {
        const mod = await import('./productSource');

        expect(mod?.createProductBrowserSidecarControlAdapterFactory).toBeTypeOf('function');
        if (!mod?.createProductBrowserSidecarControlAdapterFactory) return;

        const installManagedBrowserChromium = vi.fn(async () => ({ ok: true as const, executablePath: '/x', pinnedVersion: '1.2.3.4', integrityDigest: `sha256:${'a'.repeat(64)}` }));
        const factory = mod.createProductBrowserSidecarControlAdapterFactory({
            platform: 'linux',
            featureEnabled: true,
            autoInstallWhenMissing: false,
            resolveManagedCandidate: vi.fn(async () => ({
                source: 'managedBrowserPackage' as const,
                discoveryKind: 'managedRuntime' as const,
                available: false as const,
                disabledReason: 'not installed',
            })),
            installManagedBrowserChromium,
        });

        const result = await factory({ machineId: 'machine_no_lazy' });

        expect(installManagedBrowserChromium).not.toHaveBeenCalled();
        expect(result).toMatchObject({ ok: false, errorCode: 'managed_package_missing' });
    });

    it('stays fail-closed when a managed candidate lacks provenance (never delegates to launch)', async () => {
        const mod = await import('./productSource');

        expect(mod?.createProductBrowserSidecarControlAdapterFactory).toBeTypeOf('function');
        if (!mod?.createProductBrowserSidecarControlAdapterFactory) return;

        const factory = mod.createProductBrowserSidecarControlAdapterFactory({
            platform: 'linux',
            featureEnabled: true,
            resolveManagedCandidate: vi.fn(async () => ({
                source: 'managedBrowserPackage' as const,
                executablePath: '/home/u/.happier/tools/browser-chromium/current/chrome',
                discoveryKind: 'managedRuntime' as const,
                available: true,
            })),
        });

        const result = await factory({ machineId: 'machine_no_provenance' });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errorCode).toBe('binary_resolution_failed');
        }
    });
});
