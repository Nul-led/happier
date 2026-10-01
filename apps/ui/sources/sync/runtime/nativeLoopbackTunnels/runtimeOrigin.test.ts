import { describe, expect, it } from 'vitest';
import { resolveServerRuntimeOrigin } from './runtimeOrigin';

describe('runtime origin resolver', () => {
    it('uses the selected published endpoint for both Iroh and HTTPS carriers', () => {
        expect(resolveServerRuntimeOrigin({ serverUrl: 'https://home.example', carrier: 'iroh', runtimeOrigin: 'http://127.0.0.1:4312/' })).toBe('http://127.0.0.1:4312');
        expect(resolveServerRuntimeOrigin({ serverUrl: 'https://auth.home.example', carrier: 'https', runtimeOrigin: 'https://ingress.home.example/' })).toBe('https://ingress.home.example');
        expect(resolveServerRuntimeOrigin({ serverUrl: 'https://home.example', runtimeOrigin: 'http://127.0.0.1:4312' })).toBe('https://home.example');
    });

    it('fails closed to the stable origin for malformed native origins', () => {
        expect(resolveServerRuntimeOrigin({ serverUrl: 'https://home.example/', carrier: 'iroh', runtimeOrigin: 'javascript:alert(1)' })).toBe('https://home.example');
        expect(resolveServerRuntimeOrigin({ serverUrl: 'https://home.example/', carrier: 'iroh', runtimeOrigin: 'http://user:pass@127.0.0.1:4312' })).toBe('https://home.example');
    });
});
