import { describe, expect, it } from 'vitest';

import { resolveAgentConnectedAccountPurposeDefaults } from '@happier-dev/protocol';

import { suggestAgentDefaultForNewAccount } from './suggestAgentDefaultForNewAccount';

const CODEX_SERVICE = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
const CODEX = { agentId: 'codex', title: 'Codex', identity: { pluginId: 'happier.agent.codex', localId: 'codex' }, connectedAccounts: [{ purpose: 'model', service: CODEX_SERVICE }] };
const OPENCODE = { agentId: 'opencode', title: 'OpenCode', identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' }, connectedAccounts: [{ purpose: 'openai', service: CODEX_SERVICE }] };
const EMPTY = { connectedAccountPurposeBindingsV1: undefined, connectedServicesDefaultAuthByAgentIdV1: undefined } as never;

describe('suggestAgentDefaultForNewAccount', () => {
    it('offers the first agent that uses the service with its own login, and writes that account as its default', () => {
        const account = { service: CODEX_SERVICE, accountId: 'acct-1' };
        const suggestion = suggestAgentDefaultForNewAccount({ agents: [CODEX, OPENCODE], settings: EMPTY, account })!;

        expect(suggestion.agentTitle).toBe('Codex');
        const written = suggestion.write();
        const defaults = resolveAgentConnectedAccountPurposeDefaults({
            settings: written,
            agentId: 'codex',
            consumer: CODEX.identity,
            declarations: CODEX.connectedAccounts,
        });
        expect(defaults.map((entry) => entry.target)).toEqual([{ kind: 'account', account }]);
    });

    it('offers nothing when every agent that uses the service already has a default for it', () => {
        const first = suggestAgentDefaultForNewAccount({
            agents: [CODEX],
            settings: EMPTY,
            account: { service: CODEX_SERVICE, accountId: 'acct-1' },
        })!.write();

        expect(suggestAgentDefaultForNewAccount({
            agents: [CODEX],
            settings: first as never,
            account: { service: CODEX_SERVICE, accountId: 'acct-2' },
        })).toBeNull();
    });
});
