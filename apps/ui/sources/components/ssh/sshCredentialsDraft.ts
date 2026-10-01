import type { SshCredentialsDraft } from './SshCredentialsFields';
import type { SshConfiguredHostSuggestion } from './filterConfiguredSshHostSuggestions';

export function createDefaultSshCredentialsDraft(authMode: SshCredentialsDraft['authMode'] = 'agent'): SshCredentialsDraft {
    return {
        username: '',
        host: '',
        port: '',
        authMode,
        identityFilePath: '',
        password: '',
    };
}

export function isSshCredentialsDraftReady(draft: SshCredentialsDraft): boolean {
    return draft.host.trim().length > 0
        && (draft.port.trim().length === 0 || parseSshPortNumber(draft.port) !== null);
}

export function parseSshPortNumber(portText: string): number | null {
    const trimmed = String(portText ?? '').trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    // The saved-host schema and SSH transport share this boundary; lenient CLI parsing
    // is not evidence that an out-of-range value can connect or round-trip as a host.
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return null;
    return parsed;
}

export function applyConfiguredSshHostSuggestionToDraft(
    draft: SshCredentialsDraft,
    suggestion: SshConfiguredHostSuggestion,
): SshCredentialsDraft {
    const alias = suggestion.alias.trim();
    const hostname = suggestion.hostname.trim();
    return {
        ...draft,
        host: alias || hostname,
        ...(suggestion.username ? { username: suggestion.username } : {}),
        ...(suggestion.port ? { port: String(suggestion.port) } : {}),
    };
}
