import type { RemoteSshChecklistItem, RemoteSshChecklistMode } from './types';
import { getRemoteSshChecklistCopy } from './copy';

export function buildRemoteSshChecklistItems(params: Readonly<{
    mode: RemoteSshChecklistMode;
}>): readonly RemoteSshChecklistItem[] {
    const copy = getRemoteSshChecklistCopy(params.mode);
    const trustHostItem: RemoteSshChecklistItem = {
        id: 'trust_host',
        title: copy.trustHostTitle,
        subtitle: copy.trustHostSubtitle,
        selected: true,
        disabled: true,
        optional: false,
        stepIds: ['ssh.trust', 'ssh.hostTrust'],
        details: copy.trustHostDetails,
    };
    const installCliItem: RemoteSshChecklistItem = {
        id: 'install_cli',
        title: copy.installCliTitle,
        subtitle: copy.installCliSubtitle,
        selected: true,
        disabled: true,
        optional: false,
        stepIds: params.mode === 'remoteRelayHost' ? ['remote.cli.install'] : ['ssh.installCli'],
        details: copy.installCliDetails,
    };
    const daemonItem: RemoteSshChecklistItem = {
        id: 'install_daemon',
        title: copy.installDaemonTitle,
        subtitle: copy.installDaemonSubtitle,
        selected: true,
        disabled: true,
        optional: false,
        stepIds: ['daemon.service.install', 'daemon.service.start'],
        details: copy.installDaemonDetails,
    };
    const required: RemoteSshChecklistItem[] = params.mode === 'remoteRelayHost'
        ? [trustHostItem, installCliItem]
        : [trustHostItem, installCliItem,
        {
            id: 'configure_relay',
            title: copy.configureRelayTitle,
            subtitle: copy.configureRelaySubtitle,
            selected: true,
            disabled: true,
            optional: false,
            stepIds: ['ssh.auth.request', 'ssh.auth.approval', 'ssh.auth.wait', 'ssh.complete'],
            details: copy.configureRelayDetails,
        },
        daemonItem];

    const relayRuntime: RemoteSshChecklistItem[] = params.mode === 'remoteRelayHost'
        ? [{
            id: 'install_relay_runtime',
            title: copy.installRelayRuntimeTitle,
            subtitle: copy.installRelayRuntimeSubtitle,
            selected: true,
            disabled: true,
            optional: false,
            stepIds: ['personal_home.create', 'personal_home.pair_device'],
            details: copy.installRelayRuntimeDetails,
        }]
        : [];

    return [
        ...required,
        ...relayRuntime,
    ];
}
