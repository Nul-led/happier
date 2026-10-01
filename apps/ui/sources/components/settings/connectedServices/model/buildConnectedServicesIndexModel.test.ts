import { describe, expect, it } from 'vitest';

import type {
    QualifiedConnectedAccountGroupV4,
    QualifiedConnectedAccountProfileV4,
} from '@happier-dev/protocol';

import type { ConnectedServiceRegistryEntry } from '@/sync/domains/connectedServices/connectedServiceRegistry';

import { buildConnectedServicesIndexModel, type ConnectedServicesIndexAgentUse } from './buildConnectedServicesIndexModel';

const CLAUDE = { pluginId: 'happier.agent.claude', localId: 'anthropic' };
const CODEX = { pluginId: 'happier.agent.codex', localId: 'openai-codex' };
const GEMINI = { pluginId: 'happier.agent.gemini', localId: 'gemini' };
const GITHUB = { pluginId: 'happier.scm-github', localId: 'github' };

function entry(service: { pluginId: string; localId: string }, title: string): ConnectedServiceRegistryEntry {
    return {
        serviceId: service.localId,
        service,
        connectCommand: `happier connect ${service.localId}`,
        supportsOauth: true,
        executable: true,
        projectedTitle: title,
    };
}

function account(service: { pluginId: string; localId: string }, accountId: string): QualifiedConnectedAccountProfileV4 {
    return {
        ref: { service, accountId },
        status: 'connected',
        authenticationModeId: 'oauth',
        revisionSemantics: 'revisioned',
        credentialRevision: `cred-${accountId}`,
        configurationReady: true,
        configurationRevision: null,
        scopes: [],
    } as unknown as QualifiedConnectedAccountProfileV4;
}

function pool(service: { pluginId: string; localId: string }, groupId: string, members: string[], active: string | null): QualifiedConnectedAccountGroupV4 {
    return {
        v: 1,
        ref: { service, groupId },
        displayName: 'Work pool',
        activeConnectedAccountId: active,
        policy: { strategy: 'least_limited', autoSwitch: true },
        members: members.map((connectedAccountId, index) => ({ connectedAccountId, priority: index, enabled: true })),
    } as unknown as QualifiedConnectedAccountGroupV4;
}

function build(agentUses: readonly ConnectedServicesIndexAgentUse[] | null) {
    return buildConnectedServicesIndexModel({
        transport: 'advertised-v4',
        entries: [entry(CLAUDE, 'Claude'), entry(CODEX, 'ChatGPT'), entry(GEMINI, 'Gemini'), entry(GITHUB, 'GitHub')],
        qualifiedAccounts: [account(CLAUDE, 'work'), account(CLAUDE, 'personal'), account(CODEX, 'me'), account(GITHUB, 'gh')],
        qualifiedGroups: [pool(CLAUDE, 'work-pool', ['work', 'personal'], 'work')],
        legacyServices: [],
        defaultAccountByServiceKey: {},
        resolveLabel: (candidate) => String(candidate?.projectedTitle ?? 'Unknown'),
        resolveFallbackEntry: () => null,
        presentDiagnostics: () => ({ primary: null, supportDetails: null }),
        loadingLabel: 'Loading',
        agentUses,
    });
}

const AGENTS: readonly ConnectedServicesIndexAgentUse[] = [
    { agentId: 'claude', title: 'Claude Code', services: [CLAUDE], defaults: [{ kind: 'group', service: CLAUDE, groupId: 'work-pool' }] },
    { agentId: 'codex', title: 'Codex', services: [CODEX], defaults: [{ kind: 'account', account: { service: CODEX, accountId: 'me' } }] },
    { agentId: 'opencode', title: 'OpenCode', services: [CLAUDE, CODEX], defaults: [] },
    { agentId: 'gemini', title: 'Gemini CLI', services: [GEMINI], defaults: [] },
];

describe('buildConnectedServicesIndexModel · who uses what', () => {
    it('names the agents that sign in with each service and splits agent accounts from code and tools', () => {
        const model = build(AGENTS);
        const claude = model.sheets.find((sheet) => sheet.service.localId === 'anthropic')!;
        const github = model.sheets.find((sheet) => sheet.service.localId === 'github')!;

        expect(claude.usedBy).toEqual(['Claude Code', 'OpenCode']);
        // Their marks sit at a card's foot (lab csvc C2).
        expect(claude.usedByAgentIds).toEqual(['claude', 'opencode']);
        expect(claude.section).toBe('agents');
        expect(github.usedBy).toEqual([]);
        expect(github.section).toBe('tools');
    });

    it('offers the services an agent accepts but nobody connected, with the agents that would use them (G3)', () => {
        const model = build(AGENTS);

        expect(model.connectable.map((service) => [service.label, service.usedBy, service.section]))
            .toEqual([['Gemini', ['Gemini CLI'], 'agents']]);
    });

    it('gives each account its roles: pools it is in (and which one uses it now) and the agents it is the default for', () => {
        const model = build(AGENTS);
        const claude = model.sheets.find((sheet) => sheet.service.localId === 'anthropic')!;
        const codex = model.sheets.find((sheet) => sheet.service.localId === 'openai-codex')!;

        expect(claude.rolesByAccountId.work).toEqual({
            pools: [{ groupId: 'work-pool', inUse: true }],
            defaultFor: [],
        });
        expect(claude.rolesByAccountId.personal).toEqual({
            pools: [{ groupId: 'work-pool', inUse: false }],
            defaultFor: [],
        });
        expect(codex.rolesByAccountId.me).toEqual({ pools: [], defaultFor: ['Codex'] });
        expect(claude.pools.map((group) => [group.ref.groupId, group.defaultFor])).toEqual([['work-pool', ['Claude Code']]]);
    });

    it('keeps every sheet with the agent accounts while it is not yet known which agents use what', () => {
        const model = build(null);

        expect(model.sheets.every((sheet) => sheet.section === 'agents' && sheet.usedBy.length === 0)).toBe(true);
    });
});
