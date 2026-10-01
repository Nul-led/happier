import { describe, expect, it } from 'vitest';
import { localServiceListenerGroupKey } from './listeners.js';

describe('localServiceListenerGroupKey', () => {
  it('shares local bindings by machine/protocol/port while keeping LAN listeners distinct', () => {
    const key = (machineId: string, kind: 'loopback' | 'wildcard' | 'lan', host: string) => localServiceListenerGroupKey({ machineId, protocol: 'tcp', port: 5173, address: { kind, host } });
    expect(key('a', 'loopback', '127.0.0.1')).toBe(key('a', 'wildcard', '::'));
    expect(key('a', 'loopback', '127.0.0.1')).not.toBe(key('b', 'loopback', '127.0.0.1'));
    expect(key('a', 'lan', '192.168.1.2')).not.toBe(key('a', 'lan', '192.168.1.3'));
  });
});
