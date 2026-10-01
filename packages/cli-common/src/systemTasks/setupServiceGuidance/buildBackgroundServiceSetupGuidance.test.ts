import { describe, expect, it } from 'vitest';

import type { ManagedReleaseChannelInventory } from '../../happierRuntime/deriveManagedReleaseChannelInventory.js';
import type { HappierService } from '../../happierRuntime/types.js';
import {
    buildBackgroundServiceSetupGuidance,
    resolveBackgroundServiceSetupReconciliationDisposition,
} from './buildBackgroundServiceSetupGuidance.js';

describe('buildBackgroundServiceSetupGuidance', () => {
    it('flags default release-channel drift and conflicting background services for guided setup', async () => {
        const services: HappierService[] = [
            {
                id: 'launchd:com.happier.cli.daemon.default',
                serviceType: 'daemon',
                platform: 'darwin',
                backend: 'launchd',
                label: 'com.happier.cli.daemon.default',
                targetMode: 'default-following',
                verification: 'verified',
                ring: 'stable',
                instanceId: null,
                scope: 'user',
                definitionPath: '/Users/tester/Library/LaunchAgents/com.happier.cli.daemon.default.plist',
                executablePath: '/Users/tester/.happier/cli/current/happier',
                installed: true,
                running: true,
            },
        ];
        const managedReleaseChannels: ManagedReleaseChannelInventory = {
            defaultReleaseChannel: 'stable',
            managedReleaseChannels: [
                {
                    releaseChannel: 'stable',
                    label: 'stable',
                    version: '0.2.2',
                    installationId: 'stable-install',
                    installationPath: '/Users/tester/.happier/cli/current',
                    invokerName: 'happier',
                    isDefault: true,
                    onPath: true,
                },
                {
                    releaseChannel: 'preview',
                    label: 'preview',
                    version: '0.2.3-preview.1',
                    installationId: 'preview-install',
                    installationPath: '/Users/tester/.happier/cli-preview/current',
                    invokerName: 'hprev',
                    isDefault: false,
                    onPath: true,
                },
            ],
        };

        expect(buildBackgroundServiceSetupGuidance({
            services,
            managedReleaseChannelInventory: managedReleaseChannels,
            platform: 'darwin',
            mode: 'user',
            targetReleaseChannel: 'preview',
        })).toEqual(expect.objectContaining({
            currentDefaultReleaseChannel: 'stable',
            shouldOfferDefaultReleaseChannelSwitch: true,
            shouldPromptForServiceReplacement: false,
            exactDefaultServiceExists: true,
            conflictingServices: [],
        }));
    });

    it('keeps setup quiet when the default release-channel already matches and no conflicting services exist', async () => {
        const managedReleaseChannels: ManagedReleaseChannelInventory = {
            defaultReleaseChannel: 'preview',
            managedReleaseChannels: [
                {
                    releaseChannel: 'preview',
                    label: 'preview',
                    version: '0.2.3-preview.1',
                    installationId: 'preview-install',
                    installationPath: '/Users/tester/.happier/cli-preview/current',
                    invokerName: 'hprev',
                    isDefault: true,
                    onPath: true,
                },
            ],
        };

        expect(buildBackgroundServiceSetupGuidance({
            services: [],
            managedReleaseChannelInventory: managedReleaseChannels,
            platform: 'darwin',
            mode: 'user',
            targetReleaseChannel: 'preview',
        })).toEqual(expect.objectContaining({
            currentDefaultReleaseChannel: 'preview',
            exactDefaultServiceExists: false,
            shouldOfferDefaultReleaseChannelSwitch: false,
            shouldPromptForServiceReplacement: false,
            conflictingServices: [],
        }));
    });

    it('retains whether the exact default background service is running', () => {
        const exactStoppedService: HappierService = {
            id: 'systemd-user:happier-daemon.default',
            serviceType: 'daemon',
            platform: 'linux',
            backend: 'systemd-user',
            label: 'happier-daemon.default',
            targetMode: 'default-following',
            verification: 'verified',
            ring: 'stable',
            instanceId: null,
            scope: 'user',
            definitionPath: '/home/tester/.config/systemd/user/happier-daemon.default.service',
            executablePath: '/home/tester/.happier/cli/current/happier',
            happierHomeDir: '/home/tester/.happier',
            installed: true,
            running: false,
        };

        expect(buildBackgroundServiceSetupGuidance({
            services: [exactStoppedService],
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [],
            },
            currentHappierHomeDir: '/home/tester/.happier',
            platform: 'linux',
            mode: 'user',
            targetReleaseChannel: 'stable',
        })).toEqual(expect.objectContaining({
            exactDefaultServiceExists: true,
            exactDefaultServiceRunning: false,
        }));
    });

    it('routes an exact stopped service to the existing start lifecycle action', () => {
        const guidance = buildBackgroundServiceSetupGuidance({
            services: [{
                id: 'systemd-user:happier-daemon.default',
                serviceType: 'daemon',
                platform: 'linux',
                backend: 'systemd-user',
                label: 'happier-daemon.default',
                targetMode: 'default-following',
                verification: 'verified',
                ring: 'stable',
                instanceId: null,
                scope: 'user',
                definitionPath: '/home/tester/.config/systemd/user/happier-daemon.default.service',
                executablePath: '/home/tester/.happier/cli/current/happier',
                happierHomeDir: '/home/tester/.happier',
                installed: true,
                running: false,
            }],
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [],
            },
            currentHappierHomeDir: '/home/tester/.happier',
            platform: 'linux',
            mode: 'user',
            targetReleaseChannel: 'stable',
        });

        expect(resolveBackgroundServiceSetupReconciliationDisposition({
            guidance,
            targetChanged: false,
            tookOverManualRelayRuntime: false,
            replacedExistingServices: false,
        })).toEqual([{ kind: 'start', takeover: false }]);
    });

    it('treats verified pinned daemon services as conflicting with a default-following setup target', async () => {
        const services: HappierService[] = [
            {
                id: 'launchd:com.happier.cli.daemon.company',
                serviceType: 'daemon',
                platform: 'darwin',
                backend: 'launchd',
                label: 'com.happier.cli.daemon.company',
                targetMode: 'pinned',
                verification: 'verified',
                ring: 'stable',
                instanceId: 'company',
                scope: 'user',
                definitionPath: '/Users/tester/Library/LaunchAgents/com.happier.cli.daemon.company.plist',
                executablePath: '/Users/tester/.happier/cli/current/happier',
                serverUrl: 'https://company.example.test',
                publicServerUrl: 'https://company.example.test',
                installed: true,
                running: true,
            },
        ];

        expect(buildBackgroundServiceSetupGuidance({
            services,
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [],
            },
            platform: 'darwin',
            mode: 'user',
            targetReleaseChannel: 'stable',
        })).toEqual(expect.objectContaining({
            exactDefaultServiceExists: false,
            shouldPromptForServiceReplacement: true,
            conflictingServices: [
                expect.objectContaining({
                    label: 'com.happier.cli.daemon.company',
                    targetMode: 'pinned',
                    serverUrl: 'https://company.example.test',
                }),
            ],
        }));
    });

    it('flags a running manual relay owner so setup can prompt for takeover before installing the background service', async () => {
        expect(buildBackgroundServiceSetupGuidance({
            services: [],
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [],
            },
            currentRelayOwner: {
                serviceManaged: false,
                publicReleaseChannel: 'stable',
                cliVersion: '0.2.0',
            },
            platform: 'darwin',
            mode: 'user',
            targetReleaseChannel: 'stable',
            targetServerUrl: 'https://relay.example.test',
        })).toEqual(expect.objectContaining({
            shouldPromptForManualRelayTakeover: true,
            manualRelayOwner: {
                currentReleaseChannel: 'stable',
                currentCliVersion: '0.2.0',
            },
        }));
    });

    it('treats foreign-home default-following services as a replaceable conflict after explicit confirmation', async () => {
        const services: HappierService[] = [
            {
                id: 'launchd:com.happier.cli.daemon.default',
                serviceType: 'daemon',
                platform: 'darwin',
                backend: 'launchd',
                label: 'com.happier.cli.daemon.default',
                targetMode: 'default-following',
                verification: 'verified',
                ring: 'stable',
                instanceId: null,
                scope: 'user',
                definitionPath: '/Users/tester/Library/LaunchAgents/com.happier.cli.daemon.default.plist',
                executablePath: '/Users/other/.happier/cli/current/happier',
                happierHomeDir: '/Users/other/.happier',
                installed: true,
                running: true,
            },
        ];

        expect(buildBackgroundServiceSetupGuidance({
            services,
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [],
            },
            currentHappierHomeDir: '/Users/tester/.happier',
            platform: 'darwin',
            mode: 'user',
            targetReleaseChannel: 'stable',
            targetServerUrl: 'https://relay.example.test',
        })).toEqual(expect.objectContaining({
            shouldPromptForServiceReplacement: true,
            conflictingServices: [],
            foreignHomeConflictingServices: [
                expect.objectContaining({
                    label: 'com.happier.cli.daemon.default',
                    happierHomeDir: '/Users/other/.happier',
                }),
            ],
        }));
    });
    it('gives an explicit Home its own pinned target so the user\'s default-following service and other Homes coexist', () => {
        const userDefaultService: HappierService = {
            id: 'systemd-user:happier-daemon.default',
            serviceType: 'daemon',
            platform: 'linux',
            backend: 'systemd-user',
            label: 'happier-daemon.default',
            targetMode: 'default-following',
            verification: 'verified',
            ring: 'stable',
            instanceId: null,
            scope: 'user',
            definitionPath: '/home/tester/.config/systemd/user/happier-daemon.default.service',
            executablePath: '/home/tester/.happier/bin/happier',
            happierHomeDir: '/home/tester/.happier',
            installed: true,
            running: true,
        };
        const otherHomeService: HappierService = {
            ...userDefaultService,
            id: 'systemd-user:happier-daemon.company',
            label: 'happier-daemon.company',
            targetMode: 'pinned',
            instanceId: 'company',
            definitionPath: '/home/tester/.config/systemd/user/happier-daemon.company.service',
            serverUrl: 'https://company.example.test',
            publicServerUrl: 'https://company.example.test',
        };
        const guidance = buildBackgroundServiceSetupGuidance({
            services: [userDefaultService, otherHomeService],
            managedReleaseChannelInventory: {
                defaultReleaseChannel: 'stable',
                managedReleaseChannels: [
                    {
                        releaseChannel: 'preview',
                        label: 'preview',
                        version: '0.3.0-preview.1',
                        installationId: 'preview-install',
                        installationPath: '/home/tester/.happier/cli-preview/current',
                        invokerName: 'hprev',
                        isDefault: false,
                        onPath: true,
                    },
                ],
            },
            currentHappierHomeDir: '/home/tester/.happier',
            platform: 'linux',
            mode: 'user',
            targetReleaseChannel: 'preview',
            targetServerUrl: 'http://127.0.0.1:43110',
            serviceTarget: { targetMode: 'pinned', serverId: 'personal-home' },
        });

        expect(guidance).toEqual(expect.objectContaining({
            exactDefaultServiceExists: false,
            conflictingServices: [],
            foreignHomeConflictingServices: [],
            shouldOfferDefaultReleaseChannelSwitch: false,
            shouldPromptForServiceReplacement: false,
        }));
    });

    it('replaces only the planned services through the install itself instead of a separate remove-all step', () => {
        const guidance = buildBackgroundServiceSetupGuidance({
            services: [],
            managedReleaseChannelInventory: { defaultReleaseChannel: 'stable', managedReleaseChannels: [] },
            platform: 'linux',
            mode: 'user',
            targetReleaseChannel: 'stable',
        });

        expect(resolveBackgroundServiceSetupReconciliationDisposition({
            guidance,
            targetChanged: false,
            tookOverManualRelayRuntime: false,
            replacedExistingServices: true,
        })).toEqual([
            { kind: 'install', takeover: false, replaceExisting: true },
            { kind: 'start', takeover: false },
        ]);
    });

    it('rewrites and restarts the existing service when this run changed which CLI runs it (R12/R13 b)', () => {
        const guidance = buildBackgroundServiceSetupGuidance({
            services: [{
                id: 'systemd-user:happier-daemon.default',
                serviceType: 'daemon',
                platform: 'linux',
                backend: 'systemd-user',
                label: 'happier-daemon.default',
                targetMode: 'default-following',
                verification: 'verified',
                ring: 'stable',
                instanceId: null,
                scope: 'user',
                definitionPath: '/home/tester/.config/systemd/user/happier-daemon.default.service',
                executablePath: '/home/tester/npm-global/bin/happier',
                happierHomeDir: '/home/tester/.happier',
                installed: true,
                running: true,
            }],
            managedReleaseChannelInventory: { defaultReleaseChannel: 'stable', managedReleaseChannels: [] },
            currentHappierHomeDir: '/home/tester/.happier',
            platform: 'linux',
            mode: 'user',
            targetReleaseChannel: 'stable',
        });
        const base = { guidance, targetChanged: false, tookOverManualRelayRuntime: false, replacedExistingServices: false };

        // A running exact service with nothing changed is left alone...
        expect(resolveBackgroundServiceSetupReconciliationDisposition(base)).toEqual([]);
        // ...but the R12 answer switches its runtime: only the strict install rewrites the launcher
        // (its failure fails setup), and a restart makes the new CLI the one running.
        expect(resolveBackgroundServiceSetupReconciliationDisposition({ ...base, runtimeChanged: true })).toEqual([
            { kind: 'install', takeover: false },
            { kind: 'restart' },
        ]);
    });
});
