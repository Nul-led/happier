import type { HttpService } from '@happier-dev/plugin-sdk/http';

import type { ContributionRuntimeRegistration } from '@/plugins/runtime/api/registrationRightsHost';
import type { ResolvedVoiceProviderContribution } from '@/plugins/projection/registry/types';
import type { VoiceSpeechEndpointPolicy } from '@happier-dev/protocol';

type TargetRegistration = Readonly<{
    pluginId: string;
    occurrenceId: string;
    registration: ContributionRuntimeRegistration;
}>;

type RegisteredVoiceProviderRuntime = Extract<
    ContributionRuntimeRegistration,
    Readonly<{ family: 'voiceProviders' }>
>['value'];
export type RegisteredSpeechProviderRuntime = Extract<
    RegisteredVoiceProviderRuntime,
    Readonly<{ kind: 'speech' }>
>;

export type TargetVoiceSpeechRuntime = Readonly<{
    occurrenceId: string;
    qualifiedId: string;
    runtime: RegisteredSpeechProviderRuntime;
    contribution: Extract<ResolvedVoiceProviderContribution['definition'], { kind: 'speech' }>;
    isCurrent(): boolean;
    retirementSignal: AbortSignal;
    createHttp(
        signal: AbortSignal,
        isOperationCurrent?: () => boolean,
        endpointPolicy?: VoiceSpeechEndpointPolicy | null,
    ): Pick<HttpService, 'request'>;
}>;

type VoiceSpeechOccurrenceLifecycle = Readonly<{
    isCurrent(): boolean;
    retirementSignal: AbortSignal;
}>;

/**
 * Family adapter over the activation manager's authoritative target
 * registrations. It owns neither a second registry nor a second generation
 * decision.
 */
export function createTargetVoiceSpeechRegistry(params: Readonly<{
    voiceProviders: readonly ResolvedVoiceProviderContribution[];
    targetRegistrations: readonly TargetRegistration[];
    readPluginOccurrenceId(pluginId: string): string | null;
    resolveOccurrenceLifecycle(pluginId: string): VoiceSpeechOccurrenceLifecycle;
    createHttp(input: Readonly<{
        pluginId: string;
        localId: string;
        occurrenceId: string;
        signal: AbortSignal;
        endpointPolicy: VoiceSpeechEndpointPolicy | null;
        isCurrent(): boolean;
    }>): Pick<HttpService, 'request'>;
}>): Readonly<{
    read(ref: Readonly<{ pluginId: string; localId: string }>): TargetVoiceSpeechRuntime | null;
}> {
    const declarations = new Map(params.voiceProviders.map((provider) => [
        `${provider.pluginId}/${provider.identity.localId}`,
        provider,
    ]));
    return Object.freeze({
        read(ref) {
            const declaration = declarations.get(`${ref.pluginId}/${ref.localId}`);
            if (!declaration || declaration.definition.kind !== 'speech') return null;
            const entry = [...params.targetRegistrations].reverse().find((candidate) => (
                candidate.pluginId === ref.pluginId
                && candidate.registration.family === 'voiceProviders'
                && candidate.registration.localId === ref.localId
            ));
            if (
                !entry
                || entry.registration.family !== 'voiceProviders'
                || entry.registration.value.kind !== 'speech'
                || params.readPluginOccurrenceId(ref.pluginId) !== entry.occurrenceId
            ) return null;
            const lifecycle = params.resolveOccurrenceLifecycle(ref.pluginId);
            return Object.freeze({
                occurrenceId: entry.occurrenceId,
                qualifiedId: `${ref.pluginId}/${ref.localId}`,
                runtime: entry.registration.value,
                contribution: declaration.definition,
                isCurrent: () => (
                    lifecycle.isCurrent()
                    && params.readPluginOccurrenceId(ref.pluginId) === entry.occurrenceId
                    && params.targetRegistrations.includes(entry)
                ),
                retirementSignal: lifecycle.retirementSignal,
                createHttp: (signal, isOperationCurrent = () => true, endpointPolicy = null) => params.createHttp({
                    pluginId: ref.pluginId,
                    localId: ref.localId,
                    occurrenceId: entry.occurrenceId,
                    signal,
                    endpointPolicy,
                    isCurrent: () => (
                        lifecycle.isCurrent()
                        && params.readPluginOccurrenceId(ref.pluginId) === entry.occurrenceId
                        && params.targetRegistrations.includes(entry)
                        && isOperationCurrent()
                    ),
                }),
            });
        },
    });
}
