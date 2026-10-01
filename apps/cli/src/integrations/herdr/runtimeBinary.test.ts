import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSupportedHerdrVersion, resolveHerdrRuntimeBinary } from './runtimeBinary';

afterEach(() => vi.unstubAllEnvs());

describe('Herdr runtime binary', () => {
  it('preserves a completed version probe when the host event loop stalls past its deadline', async () => {
    // The real executable supplies a stable version banner and exits immediately. Its output
    // is supported by the same semver contract; no internal deadline logic is replaced.
    vi.stubEnv('HERDR_BIN_PATH', process.execPath);
    expect(isSupportedHerdrVersion(process.version)).toBe(true);
    const pending = resolveHerdrRuntimeBinary({ actionTimeoutMs: 200 });
    const until = Date.now() + 1_500;
    while (Date.now() < until) { /* Reproduce a stalled daemon timers phase. */ }
    await expect(pending).resolves.toBe(process.execPath);
  });
});

describe('Herdr minimum version', () => {
  it('requires stable releases at or after 0.9.2', () => {
    expect(isSupportedHerdrVersion('0.9.1-preview.2026-09-28-80c0c07250d2')).toBe(false);
    expect(isSupportedHerdrVersion('0.9.1-preview.2026-09-29-abcdef123456')).toBe(false);
    expect(isSupportedHerdrVersion('0.9.1-preview.2026-09-27-abcdef123456')).toBe(false);
    expect(isSupportedHerdrVersion('herdr 0.9.1')).toBe(false);
    expect(isSupportedHerdrVersion('0.8.9')).toBe(false);
    expect(isSupportedHerdrVersion('1.0.0')).toBe(true);
    expect(isSupportedHerdrVersion('1.0.0-preview.1')).toBe(false);
    expect(isSupportedHerdrVersion('0.9.2')).toBe(true);
    expect(isSupportedHerdrVersion('0.10.0')).toBe(true);
  });
});
