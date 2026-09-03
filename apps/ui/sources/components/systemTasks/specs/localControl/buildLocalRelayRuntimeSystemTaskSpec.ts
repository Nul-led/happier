import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskSpec } from '@happier-dev/protocol';
import {
    createPersonalHomeRuntimeSpec,
    renderPersonalHomeRuntimeEnv,
} from '@happier-dev/cli-common/firstPartyRuntime/personalHome/runtimeSpec';

import { resolvePreferredPublicReleaseRingLabelForCurrentApp } from '@/sync/runtime/resolvePublicReleaseRing';

type LocalRelayRuntimeTaskKind =
    | 'relay.runtime.status.v1'
    | 'relay.runtime.installOrUpdate.v1'
    | 'relay.runtime.start.v1'
    | 'relay.runtime.restart.v1'
    | 'relay.runtime.stop.v1'
    | 'relay.runtime.uninstall.v1'
    | 'relay.runtime.personal_home.inspect.v1'
    | 'relay.runtime.personal_home.backup.v1'
    | 'relay.runtime.personal_home.verify_backup.v1'
    | 'relay.runtime.personal_home.restore.v1'
    | 'relay.runtime.personal_home.erase.v1';

export type LocalRelayRuntimePurpose = Readonly<{
    kind: 'personal-home';
    canonicalServerUrl: string;
}>;

export type LocalRelayRuntimeTaskOptions = Readonly<{
    purpose?: LocalRelayRuntimePurpose;
    anonymousSignupEnabled?: boolean;
    expectedPersonalHomeState?: Readonly<{
        installed: boolean;
        canonicalServerUrl: string | null;
        dataPresent: boolean;
    }>;
    personalHomeOperation?: Readonly<{
        action?: 'recover';
        outputPath?: string;
        archivePath?: string;
        confirmOverwrite?: boolean;
    }>;
}>;

const LOCAL_RELAY_RUNTIME_PARAMS = {
    target: { kind: 'local' as const },
    channel: resolvePreferredPublicReleaseRingLabelForCurrentApp(),
    mode: 'user' as const,
};

export function buildLocalRelayRuntimeSystemTaskSpec(
    kind: LocalRelayRuntimeTaskKind,
    options: LocalRelayRuntimeTaskOptions = {},
): SystemTaskSpec {
    if (kind.startsWith('relay.runtime.personal_home.')) {
        const operation = options.personalHomeOperation ?? {};
        const requestedCanonicalServerUrl = options.purpose?.canonicalServerUrl.trim() ?? '';
        if (!requestedCanonicalServerUrl) throw new Error('The inspected Personal Home purpose is required.');
        const operationBase = {
            ...LOCAL_RELAY_RUNTIME_PARAMS,
            purpose: { kind: 'personal-home' as const, canonicalServerUrl: requestedCanonicalServerUrl },
        };
        const archivePath = operation.archivePath?.trim() ?? '';
        const outputPath = operation.outputPath?.trim() ?? '';
        let operationParams: Record<string, unknown> = {};
        switch (kind) {
            case 'relay.runtime.personal_home.inspect.v1':
                operationParams = {};
                break;
            case 'relay.runtime.personal_home.backup.v1':
                operationParams = {
                    ...(outputPath ? { outputPath } : {}),
                };
                break;
            case 'relay.runtime.personal_home.verify_backup.v1':
                if (!archivePath) throw new Error('A backup archive path is required.');
                operationParams = { archivePath };
                break;
            case 'relay.runtime.personal_home.restore.v1':
                if (operation.action === 'recover') {
                    operationParams = { action: operation.action };
                    break;
                }
                if (!archivePath) throw new Error('A backup archive path is required.');
                operationParams = {
                    archivePath,
                    ...(operation.confirmOverwrite === true ? { confirmOverwrite: true } : {}),
                };
                break;
            case 'relay.runtime.personal_home.erase.v1':
                operationParams = {};
                break;
        }
        return {
            protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
            kind,
            params: { ...operationBase, ...operationParams },
        };
    }

    const canonicalServerUrl = options.purpose?.canonicalServerUrl?.trim() ?? '';
    const purpose = canonicalServerUrl
        ? { kind: 'personal-home' as const, canonicalServerUrl }
        : undefined;
    const port = purpose ? Number(new URL(purpose.canonicalServerUrl).port) : Number.NaN;
    const env = purpose && Number.isInteger(port) && port > 0
        ? renderPersonalHomeRuntimeEnv({
            spec: createPersonalHomeRuntimeSpec({ canonicalServerUrl }),
            port,
            anonymousSignupEnabled: options.anonymousSignupEnabled,
        })
        : undefined;
    return {
        protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
        kind,
        params: {
            ...LOCAL_RELAY_RUNTIME_PARAMS,
            ...(purpose ? { purpose } : {}),
            ...(env ? { env } : {}),
            ...(options.expectedPersonalHomeState
                ? { expectedPersonalHomeState: options.expectedPersonalHomeState }
                : {}),
        },
    };
}
