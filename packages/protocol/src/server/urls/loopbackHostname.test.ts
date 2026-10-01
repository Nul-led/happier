import { describe, expect, it } from 'vitest';

import { isLiteralLoopbackHostname, isLoopbackHostname } from './loopbackHostname.js';

describe('isLoopbackHostname', () => {
  it('recognises an IPv6 literal with the brackets URL parsing leaves on', () => {
    // `new URL('http://[::1]:3005').hostname` returns "[::1]". Comparing that
    // string to '::1' is the miss that ships silently.
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isLoopbackHostname('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
    expect(isLoopbackHostname('::1%lo0')).toBe(true);
    expect(isLoopbackHostname('[::1]%lo0')).toBe(false);
  });

  it('recognises dotted and browser-normalized IPv4-mapped IPv6 loopback literals', () => {
    expect(isLoopbackHostname('[::ffff:127.0.0.1]')).toBe(true);
    expect(isLoopbackHostname('[::ffff:7f00:1]')).toBe(true);
    expect(isLoopbackHostname('0:0:0:0:0:ffff:7f00:2')).toBe(true);
    expect(isLoopbackHostname('[::ffff:192.168.1.1]')).toBe(false);
    expect(isLoopbackHostname('[::ffff:c0a8:101]')).toBe(false);
  });

  it('recognises the whole 127.0.0.0/8 range', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('127.0.0.2')).toBe(true);
    expect(isLoopbackHostname('127.255.255.254')).toBe(true);
    expect(isLoopbackHostname('2130706433')).toBe(true);
    expect(isLoopbackHostname('0177.0.0.1')).toBe(true);
    expect(isLoopbackHostname('2147483649')).toBe(false);
    expect(isLoopbackHostname('0300.0.0.1')).toBe(false);
  });

  it('recognises localhost and the reserved .localhost TLD', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('relay.localhost')).toBe(true);
  });

  it('ignores a trailing dot and letter case', () => {
    expect(isLoopbackHostname('LocalHost.')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1.')).toBe(true);
  });

  it('does not treat an all-interfaces bind as loopback', () => {
    // 0.0.0.0 means every interface, not this machine. Callers that also want
    // to reject it say so themselves.
    expect(isLoopbackHostname('0.0.0.0')).toBe(false);
  });

  it('does not treat LAN, tailnet or public hosts as loopback', () => {
    expect(isLoopbackHostname('192.168.1.9')).toBe(false);
    expect(isLoopbackHostname('100.84.140.109')).toBe(false);
    expect(isLoopbackHostname('relay.example.com')).toBe(false);
    expect(isLoopbackHostname('studio.example.ts.net')).toBe(false);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(isLoopbackHostname('')).toBe(false);
    expect(isLoopbackHostname('127.0.0.999')).toBe(false);
    expect(isLoopbackHostname('127.0.0')).toBe(false);
    expect(isLoopbackHostname('::ffff:127.0.0.1.1')).toBe(false);
    expect(isLoopbackHostname('%5B::1%5D')).toBe(false);
    expect(isLoopbackHostname('localhost%lo0')).toBe(false);
    expect(isLoopbackHostname('notlocalhost')).toBe(false);
  });
});

describe('isLiteralLoopbackHostname', () => {
  it('accepts literal IPv4, IPv6 and browser-normalized integer loopback addresses', () => {
    expect(isLiteralLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLiteralLoopbackHostname('127.255.255.254')).toBe(true);
    expect(isLiteralLoopbackHostname('[::1]')).toBe(true);
    expect(isLiteralLoopbackHostname('::ffff:127.0.0.1')).toBe(true);
    expect(isLiteralLoopbackHostname('2130706433')).toBe(true);
  });

  it('accepts exact localhost but rejects names beneath the reserved localhost namespace', () => {
    expect(isLiteralLoopbackHostname('localhost')).toBe(true);
    expect(isLiteralLoopbackHostname('LocalHost.')).toBe(true);
    expect(isLiteralLoopbackHostname('worker.localhost')).toBe(false);
    expect(isLiteralLoopbackHostname('nested.worker.localhost')).toBe(false);
  });
});
