import { describe, expect, it } from 'vitest';
import { createDefaultSshCredentialsDraft, isSshCredentialsDraftReady, parseSshPortNumber } from './sshCredentialsDraft';

describe('SSH draft contract', () => {
    it('allows an SSH-config alias without a username, but requires a host', () => {
        const draft = createDefaultSshCredentialsDraft();
        expect(isSshCredentialsDraftReady(draft)).toBe(false);
        expect(isSshCredentialsDraftReady({ ...draft, host: 'build-box' })).toBe(true);
    });
    it('keeps optional ports within the transport and saved-host boundary', () => {
        expect(parseSshPortNumber('65535')).toBe(65535);
        for (const port of ['', '22', '65535']) {
            expect(isSshCredentialsDraftReady({ ...createDefaultSshCredentialsDraft(), host: 'box', port })).toBe(true);
        }
        for (const port of ['0', '-1', '65536', '70000', 'invalid']) {
            expect(parseSshPortNumber(port)).toBeNull();
            expect(isSshCredentialsDraftReady({ ...createDefaultSshCredentialsDraft(), host: 'box', port })).toBe(false);
        }
    });
    it('lets a transport select its supported default auth mode without recreating the draft', () => {
        expect(createDefaultSshCredentialsDraft().authMode).toBe('agent');
        expect(createDefaultSshCredentialsDraft('password')).toEqual({
            ...createDefaultSshCredentialsDraft(), authMode: 'password',
        });
    });
});
