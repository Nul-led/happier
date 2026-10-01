import { config } from '@/config';
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
