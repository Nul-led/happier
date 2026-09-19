import { config } from '@/config';
import type { SshCredentialsDraft } from '@/components/ssh/SshCredentialsFields';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import type { ServerProfileSource } from '@/sync/domains/server/serverProfiles';
import { resolveAppVariant } from '@/sync/runtime/appVariant';
import { resolveCliInvokerNameForCurrentApp, resolvePreferredPublicReleaseRingIdForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';

import {
    buildHappierCliInstallAndRunCommand,
    buildHappierCliInstallCommand,
    buildHappierCliInstallAndRunPowershellCommand,
    buildHappierCliInstallPowershellCommand,
    type HappierInstallerRunAction,
} from '@/components/sessions/guidance/happierCliInstallCommand';

export { resolveCliInvokerNameForCurrentApp };

export function buildCliInstallCommandForCurrentApp(): string {
    const appVariant = resolveAppVariant({
        appVariant: config.variant,
        envAppEnv: process.env.APP_ENV,
        envExpoPublicAppEnv: process.env.EXPO_PUBLIC_APP_ENV,
    }) ?? 'production';
    const publicReleaseRingOverride = resolvePreferredPublicReleaseRingIdForCurrentApp();

    return buildHappierCliInstallCommand({
        appVariant,
        distTagOverride: config.cliNpmDistTag,
        publicReleaseRingOverride,
    });
}

export function buildCliInstallPowershellCommandForCurrentApp(): string {
    const appVariant = resolveAppVariant({
        appVariant: config.variant,
        envAppEnv: process.env.APP_ENV,
        envExpoPublicAppEnv: process.env.EXPO_PUBLIC_APP_ENV,
    }) ?? 'production';
    const publicReleaseRingOverride = resolvePreferredPublicReleaseRingIdForCurrentApp();

    return buildHappierCliInstallPowershellCommand({
        appVariant,
        distTagOverride: config.cliNpmDistTag,
        publicReleaseRingOverride,
    });
}

export function buildCliInstallAndRunCommandForCurrentApp(run: Readonly<{
    action: HappierInstallerRunAction;
    args?: readonly string[];
}>): string {
    const appVariant = resolveAppVariant({
        appVariant: config.variant,
        envAppEnv: process.env.APP_ENV,
        envExpoPublicAppEnv: process.env.EXPO_PUBLIC_APP_ENV,
    }) ?? 'production';
    const publicReleaseRingOverride = resolvePreferredPublicReleaseRingIdForCurrentApp();

    return buildHappierCliInstallAndRunCommand({
        appVariant,
        distTagOverride: config.cliNpmDistTag,
        publicReleaseRingOverride,
    }, run);
}

export function buildCliInstallAndRunPowershellCommandForCurrentApp(run: Readonly<{
    action: HappierInstallerRunAction;
    args?: readonly string[];
}>): string {
    const appVariant = resolveAppVariant({
        appVariant: config.variant,
        envAppEnv: process.env.APP_ENV,
        envExpoPublicAppEnv: process.env.EXPO_PUBLIC_APP_ENV,
    }) ?? 'production';
    const publicReleaseRingOverride = resolvePreferredPublicReleaseRingIdForCurrentApp();

    return buildHappierCliInstallAndRunPowershellCommand({
        appVariant,
        distTagOverride: config.cliNpmDistTag,
        publicReleaseRingOverride,
    }, run);
}

export function buildAuthLoginCommandForServerUrl(serverUrl: string): string {
    const invoker = resolveCliInvokerNameForCurrentApp();
    const trimmed = String(serverUrl).trim();
    if (!trimmed) return `${invoker} auth login`;
    return `${invoker} auth login --server-url ${trimmed} --persist --method web`;
}

export function buildHappierSetupCommand(params: Readonly<{
    relayUrl: string | null;
    skipDaemon?: boolean;
    skipProviders?: boolean;
    yes?: boolean;
}>): string {
    const invoker = resolveCliInvokerNameForCurrentApp();
    const relayUrl = String(params.relayUrl ?? '').trim();
    const base = relayUrl ? `${invoker} setup --home-url ${relayUrl}` : `${invoker} setup`;
    const flags: string[] = [];
    if (params.skipDaemon) flags.push('--skip-daemon');
    if (params.skipProviders) flags.push('--skip-providers');
    return flags.length > 0 ? `${base} ${flags.join(' ')}` : base;
}

export type WebDesktopSetupHandoffTarget =
    | Readonly<{ kind: 'https'; homeUrl: string }>
    | Readonly<{ kind: 'account_service' }>
    | Readonly<{ kind: 'descriptor_file_required' }>;

/**
 * Selects only a descriptor-proven setup carrier for the copy/paste handoff.
 * The installer script already occupies stdin, so this surface cannot safely
 * pipe a strict descriptor to `happier setup --home-descriptor-file -`.
 */
export function resolveWebDesktopSetupHandoffTarget(params: Readonly<{
    descriptor: HomeConnectionDescriptorV1 | null;
    profileSource: ServerProfileSource | null;
    fallbackHomeUrl: string | null;
}>): WebDesktopSetupHandoffTarget {
    if (params.descriptor) {
        const httpsEndpoint = params.descriptor.endpoints.find((endpoint) => endpoint.kind === 'https');
        if (httpsEndpoint) return { kind: 'https', homeUrl: httpsEndpoint.url };
        // A descriptor without an HTTPS endpoint (an Iroh-only Home) is still a
        // Home this handoff can name exactly. How the profile was discovered
        // does not change that, and an untargeted `happier setup` would send the
        // remote machine into the sign-in-service journey instead of the Home
        // the user is looking at.
        return { kind: 'descriptor_file_required' };
    }

    const fallbackHomeUrl = String(params.fallbackHomeUrl ?? '').trim();
    return fallbackHomeUrl
        ? { kind: 'https', homeUrl: fallbackHomeUrl }
        : { kind: 'account_service' };
}

function buildRemoteSshArgs(params: Readonly<{
    draft: SshCredentialsDraft;
    installRelayRuntime?: boolean;
}>): string[] {
    const username = params.draft.username.trim();
    const host = params.draft.host.trim();
    const port = params.draft.port.trim();
    const identityFilePath = params.draft.identityFilePath.trim();
    const args: string[] = [
        `--ssh-user ${username || '<user>'}`,
        `--ssh-host ${host || '<host>'}`,
    ];
    if (port) {
        args.push(`--ssh-port ${port}`);
    }
    args.push(`--ssh-auth ${params.draft.authMode}`);
    if (params.draft.authMode === 'keyfile' && identityFilePath) {
        args.push(`--identity-file ${identityFilePath}`);
    }
    if (params.installRelayRuntime) {
        args.push('--install-relay-runtime');
    }
    return args;
}

export function buildRemoteMachineSetupCommand(params: Readonly<{
    draft: SshCredentialsDraft;
    installRelayRuntime?: boolean;
}>): string {
    const invoker = resolveCliInvokerNameForCurrentApp();
    return [
        `${invoker} machine setup`,
        ...buildRemoteSshArgs({ draft: params.draft }),
        '--yes',
    ].join(' ');
}

export function buildRemotePersonalHomeCreateCommand(params: Readonly<{
    draft: SshCredentialsDraft;
}>): string {
    const invoker = resolveCliInvokerNameForCurrentApp();
    const username = params.draft.username.trim();
    const host = params.draft.host.trim();
    const target = username ? `${username}@${host || '<host>'}` : (host || '<host>');
    return [
        `${invoker} home create`,
        `--ssh ${target}`,
    ].join(' ');
}

export function buildRemoteRelayHostStatusCommand(params: Readonly<{
    draft: SshCredentialsDraft;
}>): string {
    const invoker = resolveCliInvokerNameForCurrentApp();
    return [
        `${invoker} relay host status`,
        ...buildRemoteSshArgs({ draft: params.draft }),
        '--json',
    ].join(' ');
}
