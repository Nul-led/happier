import { Modal } from '@/modal';
import { t } from '@/text';

import type { SystemTaskPromptEnvelope } from '../prompts/readLatestSystemTaskPrompt';
import { buildBackgroundServiceReplacementPromptBody } from '../prompts/backgroundServiceReplacementPromptPresentation';

import { presentCliChoice } from './presentCliChoice';
import { resolveThisComputerSetupPrompt } from './resolveThisComputerSetupPrompt';

function buildPromptBody(prompt: ReturnType<typeof resolveThisComputerSetupPrompt>): string | undefined {
    if (!prompt) {
        return undefined;
    }

    if (prompt.kind === 'releaseChannel.switchDefaultForSetup') {
        const lines = [
            prompt.targetServerUrl,
            prompt.currentDefaultReleaseChannel && `${prompt.currentDefaultReleaseChannel} → ${prompt.targetReleaseChannel}`,
            ...prompt.managedReleaseChannels.map((entry) => {
                const version = entry.version ? ` • ${entry.version}` : '';
                return `${entry.label}${version}`;
            }),
        ].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
        return lines.length > 0 ? lines.join('\n') : undefined;
    }

    if (prompt.kind === 'daemon.takeOverManualRelayRuntimeForSetup' || prompt.kind === 'setup.cliChoice') {
        return undefined;
    }

    return buildBackgroundServiceReplacementPromptBody({
        targetServerUrl: prompt.targetServerUrl,
        targetReleaseChannel: prompt.targetReleaseChannel,
        services: prompt.services,
        format: 'compact',
    });
}

export async function answerThisComputerSetupPrompt(prompt: SystemTaskPromptEnvelope): Promise<unknown> {
    const parsedPrompt = resolveThisComputerSetupPrompt(prompt);
    if (!parsedPrompt) return undefined;
    if (parsedPrompt.kind === 'setup.cliChoice') {
        return { choice: await presentCliChoice(parsedPrompt) };
    }
    const confirmed = await Modal.confirm(parsedPrompt.message, buildPromptBody(parsedPrompt), {
        confirmText: parsedPrompt.kind === 'releaseChannel.switchDefaultForSetup'
            || parsedPrompt.kind === 'daemon.takeOverManualRelayRuntimeForSetup'
            ? t('common.continue') : t('settings.machineSetupRemotePromptReplaceServicesAction'),
        cancelText: t('common.cancel'),
    });
    if (parsedPrompt.kind === 'releaseChannel.switchDefaultForSetup') return { switchDefaultReleaseChannel: confirmed };
    if (parsedPrompt.kind === 'daemon.takeOverManualRelayRuntimeForSetup') return { takeOverManualRelayRuntime: confirmed };
    return { replaceExistingServices: confirmed };
}
