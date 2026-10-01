import { describe, expect, it } from 'vitest';
import { buildLaunchdPlistXml } from './launchd.js';

describe('launchd optional desktop attribution and login trigger', () => {
  const params = { label: 'dev.happier.test', programArgs: ['/bin/test'], stdoutPath: '/tmp/out', stderrPath: '/tmp/err' };
  it('escapes association identifiers and leaves absent or empty attribution byte-identical', () => {
    const plain = buildLaunchdPlistXml(params);
    const emptyParams = { ...params, associatedBundleIdentifiers: [] };
    expect(buildLaunchdPlistXml(emptyParams)).toBe(plain);
    const attributedParams = { ...params, associatedBundleIdentifiers: ['dev.happier.app', 'test<&'] };
    const attributed = buildLaunchdPlistXml(attributedParams);
    expect(attributed).toContain('<key>AssociatedBundleIdentifiers</key>');
    expect(attributed).toContain('<string>test&lt;&amp;</string>');
  });
  it('can omit every login trigger for a service that remains startable on demand', () => {
    const onDemandParams = { ...params, runAtLoad: false, keepAliveOnFailure: false };
    const onDemand = buildLaunchdPlistXml(onDemandParams);
    expect(onDemand).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
    expect(onDemand).not.toContain('KeepAlive');
    expect(buildLaunchdPlistXml(params)).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });
});
