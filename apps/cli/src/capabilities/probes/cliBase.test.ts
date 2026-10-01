import { describe, expect, it } from 'vitest';

import { buildCliCapabilityData } from './cliBase';

describe('CLI inventory capability projection', () => {
    it('preserves own-CLI facts separately from runtime dependencies', () => {
        const entry = {
            available: false,
            installed: false,
            dependencies: [{ key: 'dep.acp', installed: true, version: '1.1.1' }],
            platform: { supported: false as const, reason: 'arch' as const },
            install: { available: false, mode: 'none' as const, sizeBytes: null, guideUrl: null },
            signIn: { status: 'unknown' as const, loginSupport: 'login_terminal' as const },
        };
        expect(buildCliCapabilityData({ request: { id: 'cli.antigravity', params: { includeLoginStatus: true } }, entry }))
            .toMatchObject(entry);
    });
});
