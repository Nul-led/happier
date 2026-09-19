import { describe, expect, it, vi } from 'vitest';

describe('wizardCliCommands', () => {
    const sshDraft = {
        username: 'operator',
        host: 'machine.example.test',
        port: '22',
        authMode: 'agent' as const,
        identityFilePath: '',
        password: '',
    };

    it('renders preview lane commands using the hprev shim', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'preview' } }));
        const commands = await import('./wizardCliCommands');
        expect(commands.buildAuthLoginCommandForServerUrl('https://api.happier.dev')).toMatch(/^hprev\s/);
        expect(commands.buildHappierSetupCommand({ relayUrl: 'https://api.happier.dev' })).toMatch(/^hprev\s/);
    });

    it('renders dev lane commands using the hdev shim', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'publicdev' } }));
        const commands = await import('./wizardCliCommands');
        expect(commands.buildAuthLoginCommandForServerUrl('https://api.happier.dev')).toMatch(/^hdev\s/);
        expect(commands.buildHappierSetupCommand({ relayUrl: 'https://api.happier.dev' })).toMatch(/^hdev\s/);
    });

    it('renders stable lane commands using the happier shim', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');
        expect(commands.buildAuthLoginCommandForServerUrl('https://api.happier.dev')).toMatch(/^happier\s/);
        expect(commands.buildHappierSetupCommand({ relayUrl: 'https://api.happier.dev' })).toBe(
            'happier setup --home-url https://api.happier.dev',
        );
    });

    it('never presents public setup as an unattended approval flow', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');
        expect(commands.buildHappierSetupCommand({
            relayUrl: 'https://api.happier.dev',
            yes: true,
        })).toBe('happier setup --home-url https://api.happier.dev');
    });

    it('never presents an Iroh-only Home canonical URL as an HTTPS setup target', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');
        const descriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_home_iroh',
            canonicalServerUrl: 'http://127.0.0.1:3005',
            revision: 1,
            endpoints: [{
                kind: 'iroh' as const,
                endpointId: 'endpoint-1',
                relayUrls: ['https://relay.example.test'],
            }],
        };

        // A descriptor-proven Home is targeted by its descriptor whatever
        // discovered it: the Directory-sourced case used to fall through to a
        // target-less `happier setup`, which silently sent the remote machine
        // into the sign-in-service journey instead of the Home on screen.
        expect(commands.resolveWebDesktopSetupHandoffTarget({
            descriptor,
            profileSource: 'account-directory',
            fallbackHomeUrl: descriptor.canonicalServerUrl,
        })).toEqual({ kind: 'descriptor_file_required' });
        expect(commands.resolveWebDesktopSetupHandoffTarget({
            descriptor,
            profileSource: 'desktop-personal-home',
            fallbackHomeUrl: descriptor.canonicalServerUrl,
        })).toEqual({ kind: 'descriptor_file_required' });
    });

    it('keeps the sign-in-service handoff only when there is no Home to target', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');

        expect(commands.resolveWebDesktopSetupHandoffTarget({
            descriptor: null,
            profileSource: 'account-directory',
            fallbackHomeUrl: null,
        })).toEqual({ kind: 'account_service' });
    });

    it('uses an exact descriptor-declared HTTPS endpoint for the setup handoff', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');

        expect(commands.resolveWebDesktopSetupHandoffTarget({
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_home_https',
                canonicalServerUrl: 'http://127.0.0.1:3005',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
            },
            profileSource: 'manual',
            fallbackHomeUrl: 'http://127.0.0.1:3005',
        })).toEqual({ kind: 'https', homeUrl: 'https://home.example.test' });
    });

    it('routes remote Personal Home handoff through home create instead of generic hosting', async () => {
        vi.resetModules();
        vi.doMock('@/config', () => ({ config: { variant: 'production' } }));
        const commands = await import('./wizardCliCommands');

        expect(commands.buildRemoteMachineSetupCommand({
            draft: sshDraft,
            installRelayRuntime: true,
        })).not.toContain('--install-relay-runtime');
        expect(commands.buildRemotePersonalHomeCreateCommand({
            draft: sshDraft,
        })).toBe('happier home create --ssh operator@machine.example.test');
    });
});
