import * as React from 'react';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import type { SshCredentialsDraft } from '@/components/ssh/SshCredentialsFields';
import { SshCredentialsFields } from '@/components/ssh/SshCredentialsFields';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import type { ServerProfileSource } from '@/sync/domains/server/serverProfiles';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';

import {
    buildCliInstallAndRunCommandForCurrentApp,
    buildCliInstallAndRunPowershellCommandForCurrentApp,
    buildRemoteMachineSetupCommand,
    resolveWebDesktopSetupHandoffTarget,
} from '../../commands/wizardCliCommands';
import {
    WizardGuidedHandoff,
    WizardGuidedHandoffNote,
    WizardGuidedHandoffTerminal,
} from '../../ui/WizardGuidedHandoff';
import { t } from '@/text';

export type WebDesktopRemoteSshHandoffContentProps = Readonly<{
    testID: string;
    terminalTestID?: string;
    sshFieldTestIDPrefix?: string;
    draft: SshCredentialsDraft;
    onDraftChange: (next: SshCredentialsDraft) => void;
    relayUrl: string | null;
    homeConnectionDescriptor: HomeConnectionDescriptorV1 | null;
    homeProfileSource: ServerProfileSource | null;
    installRelayRuntime: boolean;
}>;

export function WebDesktopRemoteSshHandoffContent(props: WebDesktopRemoteSshHandoffContentProps) {
    const setupTarget = React.useMemo(() => resolveWebDesktopSetupHandoffTarget({
        descriptor: props.homeConnectionDescriptor,
        profileSource: props.homeProfileSource,
        fallbackHomeUrl: props.relayUrl,
    }), [props.homeConnectionDescriptor, props.homeProfileSource, props.relayUrl]);
    const setupArgs = React.useMemo(() => {
        const args: string[] = [];
        if (setupTarget.kind === 'https') {
            args.push('--home-url', setupTarget.homeUrl);
        } else if (setupTarget.kind === 'descriptor_file_required') {
            args.push('--home-descriptor-file', './happier-home.json');
        }
        args.push('--skip-providers');
        return args;
    }, [setupTarget]);
    const installAndSetupCommand = React.useMemo(() => buildCliInstallAndRunCommandForCurrentApp({
        action: 'setup',
        args: setupArgs,
    }), [setupArgs]);
    const installAndSetupWindowsCommand = React.useMemo(() => buildCliInstallAndRunPowershellCommandForCurrentApp({
        action: 'setup',
        args: setupArgs,
    }), [setupArgs]);
    const sshCommand = React.useMemo(() => buildRemoteMachineSetupCommand({
        draft: props.draft,
        installRelayRuntime: props.installRelayRuntime,
    }), [props.draft, props.installRelayRuntime]);
    const copyHomeDescriptor = React.useCallback(async () => {
        if (!props.homeConnectionDescriptor) return;
        await setClipboardStringSafe(`${JSON.stringify(props.homeConnectionDescriptor, null, 2)}\n`);
    }, [props.homeConnectionDescriptor]);

    return (
        <WizardGuidedHandoff testID={props.testID}>
            {setupTarget.kind === 'descriptor_file_required' ? (
                <>
                    <WizardGuidedHandoffNote
                        testID={`${props.testID}-descriptor-required`}
                        title={t('setupOnboarding.webDesktopOnlySetupCommandTitle')}
                        subtitle={t('setupOnboarding.webDesktopOnlyDescriptorFileRequiredSubtitle')}
                    />
                    <RoundButton
                        testID={`${props.testID}-copy-descriptor`}
                        size="normal"
                        title={t('common.copy')}
                        onPress={copyHomeDescriptor}
                    />
                </>
            ) : null}
            <SshCredentialsFields
                testIDPrefix={props.sshFieldTestIDPrefix ?? `${props.testID}-ssh`}
                layoutVariant="wizard"
                value={props.draft}
                onChange={props.onDraftChange}
            />
            <WizardGuidedHandoffTerminal
                testID={props.terminalTestID ?? `${props.testID}-terminal`}
                steps={[
                    {
                        title: t('setupOnboarding.webDesktopOnlySetupCommandTitle'),
                        subtitle: t('setupOnboarding.webDesktopOnlySetupRemotePrereqsSubtitle'),
                        code: installAndSetupCommand,
                        windowsCode: installAndSetupWindowsCommand,
                        windowsLanguage: 'powershell',
                        scrollTestIDSuffix: 'setup',
                    },
                    {
                        title: t('settings.machineSetupSshMachineTitle'),
                        subtitle: t('settings.machineSetupSshMachineSubtitle'),
                        code: sshCommand,
                        scrollTestIDSuffix: 'remote-ssh-setup',
                    },
                ]}
            />
        </WizardGuidedHandoff>
    );
}
