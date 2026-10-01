import { AGENTS } from '@/agent/catalog/registry';
import { normalizeCliAuthStatusDraft } from './normalizeCliAuthStatusDraft';
import type { CliAuthSpec, CliAuthStatus } from './types';

/** Native, non-interactive auth facts from the admitted Agent's existing probe. */
export async function detectNativeAgentCliAuthStatus(params: Readonly<{
    agentId: string;
    resolvedPath: string;
    authSpec?: CliAuthSpec | null;
    processEnv?: NodeJS.ProcessEnv;
}>): Promise<CliAuthStatus | null> {
    try {
        const spec = params.authSpec === undefined
            ? await AGENTS[params.agentId]?.getCliAuthSpec?.()
            : params.authSpec;
        if (spec?.isSafeForBackgroundChecks !== true || !spec.detectAuthStatus) return null;
        const checkedAt = Date.now();
        const draft = normalizeCliAuthStatusDraft(
            await spec.detectAuthStatus({ resolvedPath: params.resolvedPath, processEnv: params.processEnv }),
        );
        if (!draft) return null;
        return { checkedAt, ...draft };
    } catch {
        return null;
    }
}
