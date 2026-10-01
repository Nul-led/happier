import { describe, expect, it, vi } from 'vitest';

// App configuration is the environment adapter; retain the real command and release-ring owners.
vi.mock('@/config', () => ({ config: { variant: 'production', identityVariant: 'stable' } }));
import { buildMachineAddCommand, detectClientCommandOs, MACHINE_ADD_COMMAND_OS } from './machineAddCommand';
import { createDefaultSshCredentialsDraft } from '@/components/ssh/sshCredentialsDraft';

const home = { descriptor: null, profileSource: null, fallbackHomeUrl: 'https://home.example.test' };
describe('machine add commands', () => {
    it('installs and joins the descriptor-proven Home on each OS', () => {
        for (const os of MACHINE_ADD_COMMAND_OS) {
            const command = buildMachineAddCommand({ ...home, os, kind: 'joinHome', descriptor: {
                v: 1, homeServerIdentityId: 'srv_home', canonicalServerUrl: 'http://127.0.0.1:3005', revision: 1,
                endpoints: [{ kind: 'https', url: 'https://published.example.test' }],
            } });
            expect(command).toContain(' setup --home-url https://published.example.test');
            expect(command).not.toContain('127.0.0.1');
            expect(command).toContain(os === 'windows' ? 'install.ps1' : 'curl -fsSL');
        }
    });
    it('keeps an Iroh-only Home explicitly targeted by a descriptor file', () => {
        expect(buildMachineAddCommand({ ...home, os: 'linux', kind: 'joinHome', descriptor: {
            v: 1, homeServerIdentityId: 'srv_home', canonicalServerUrl: 'http://127.0.0.1:3005', revision: 1,
            endpoints: [{ kind: 'iroh', endpointId: 'endpoint-1', relayUrls: [] }],
        } })).toContain('--home-descriptor-file ./happier-home.json');
    });
    it('builds one SSH install-and-run command, preserving target, port and keyfile on all OSes', () => {
        for (const os of MACHINE_ADD_COMMAND_OS) {
            const command = buildMachineAddCommand({ ...home, kind: 'sshMachine', os, sshDraft: {
                ...createDefaultSshCredentialsDraft(), host: 'build-box', username: 'operator', port: '2222', authMode: 'keyfile', identityFilePath: '/keys/id_ed25519',
            } });
            expect(command).toContain(' machine setup ');
            expect(command).toContain('--home-url https://home.example.test');
            expect(command).toContain('--ssh-host build-box');
            expect(command).toContain('--ssh-user operator');
            expect(command).toContain('--ssh-port 2222');
            expect(command).toContain('--ssh-auth keyfile');
            expect(command).toContain('--identity-file /keys/id_ed25519');
            expect(command).toContain('--yes');
        }
    });
    it('quotes unsafe shell values for POSIX and PowerShell and never embeds a password', () => {
        const draft = { ...createDefaultSshCredentialsDraft(), host: 'box', authMode: 'keyfile' as const, identityFilePath: "C:\\keys\\O'Brien key", password: 'secret' };
        const posix = buildMachineAddCommand({ ...home, kind: 'sshMachine', os: 'linux', sshDraft: draft });
        const windows = buildMachineAddCommand({ ...home, kind: 'sshMachine', os: 'windows', sshDraft: draft });
        expect(posix).toContain("--identity-file 'C:\\keys\\O'\"'\"'Brien key'");
        expect(windows).toContain("--identity-file 'C:\\keys\\O''Brien key'");
        expect(posix + windows).not.toContain('secret');
        expect(posix + windows).not.toContain('--ssh-user');
    });
    it('detects desktop command OS and leaves unknown/mobile user agents unknown', () => {
        expect(detectClientCommandOs('Windows NT 10.0')).toBe('windows');
        expect(detectClientCommandOs('Macintosh; Intel Mac OS X')).toBe('macos');
        expect(detectClientCommandOs('X11; Linux x86_64')).toBe('linux');
        expect(detectClientCommandOs('Android Linux')).toBeNull();
        expect(detectClientCommandOs(null)).toBeNull();
    });
    it('leaves Home setup interactive and retains provider opt-out', () => {
        const command = buildMachineAddCommand({ ...home, kind: 'joinHome', os: 'linux', skipProviders: true });
        expect(command).toContain('--skip-providers');
        expect(command).not.toContain('--yes');
    });
    it('uses the account-service journey only when no Home target was supplied', () => {
        const command = buildMachineAddCommand({ ...home, fallbackHomeUrl: null, kind: 'joinHome', os: 'linux' });
        expect(command).toMatch(/&& happier setup$/);
        expect(command).not.toContain('--home-');
    });
});
