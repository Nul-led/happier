import * as React from 'react';
import { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { QualifiedConnectedAccountUiGroup } from '@/sync/domains/connectedServices/qualifiedConnectedAccountUiSource';
import {
    ConnectedServiceAuthGroupPolicyV1Schema,
    type ConnectedServiceAuthGroupPolicyV1,
    type ConnectedServiceQuotaSnapshotV1,
    type QualifiedConnectedAccountRef,
} from '@happier-dev/protocol';

import {
    buildPoolQuotaLimitCandidates,
    QualifiedPoolDetailView,
    type QualifiedPoolDetailAccount,
    type QualifiedPoolDetailMutations,
} from './QualifiedPoolDetailView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modalSpies = vi.hoisted(() => ({
    prompt: vi.fn(),
    confirm: vi.fn(),
    alert: vi.fn(),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});

vi.mock('react-native-gesture-handler', async () => {
    const { createGestureHandlerMock } = await import('@/dev/testkit/mocks/gestureHandler');
    return createGestureHandlerMock();
});

vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => fn(...args),
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            prompt: modalSpies.prompt as never,
            confirm: modalSpies.confirm as never,
            alert: modalSpies.alert as never,
        },
    }).module;
});

// Icons render a native glyph package; the view's behaviour never depends on it.
vi.mock('@/components/ui/icons/Icon', () => ({
    ICON_SIZE: { sm: 16, md: 20, lg: 24 },
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
}));

// The account block is exercised by its own suite; a passthrough surfaces the
// props this view wires (variant / order / enable / active / actions / gesture).
vi.mock('@/components/settings/connectedServices/account/QualifiedAccountBlock', () => ({
    QualifiedAccountBlock: (props: Record<string, unknown>) =>
        React.createElement('QualifiedAccountBlock', props),
    qualifiedServicePresentationKey: (service: { pluginId: string; localId: string }) =>
        `${service.pluginId}:${service.localId}`,
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/components/ui/forms/Switch', () => ({
    Switch: (props: Record<string, unknown>) => React.createElement('Switch', props),
}));

const SERVICE = { pluginId: 'acme.accounts', localId: 'openai-codex' } as const;

function accountRef(accountId: string): QualifiedConnectedAccountRef {
    return { service: { ...SERVICE }, accountId };
}

function policy(
    overrides: Partial<ConnectedServiceAuthGroupPolicyV1> = {},
): ConnectedServiceAuthGroupPolicyV1 {
    return { ...ConnectedServiceAuthGroupPolicyV1Schema.parse({}), ...overrides };
}

/** Members intentionally out of priority order so ordering is proven, not luck. */
function createGroup(
    overrides: Partial<QualifiedConnectedAccountUiGroup> = {},
): QualifiedConnectedAccountUiGroup {
    return {
        ref: { service: { ...SERVICE }, groupId: 'primary' },
        displayName: 'Team pool',
        policy: policy(),
        activeAccountId: 'work',
        revision: {
            protocol: 'v4',
            incarnation: 'qualified-group-row-primary',
            generation: 2,
            runtimeStateRevision: 1,
        },
        state: { status: 'ready' },
        members: [
            { ref: accountRef('backup'), priority: 200, enabled: true, state: {} },
            { ref: accountRef('work'), priority: 100, enabled: true, state: {} },
        ],
        ...overrides,
    };
}

const ACCOUNTS: ReadonlyArray<QualifiedPoolDetailAccount> = [
    {
        ref: accountRef('work'),
        displayName: 'Work workspace',
        providerIdentity: { email: 'work@example.com' },
        status: 'connected',
    },
    { ref: accountRef('backup'), displayName: 'backup@example.com', status: 'connected' },
    { ref: accountRef('spare'), displayName: 'spare@example.com', status: 'connected' },
];

type PatchMemberInput = Parameters<QualifiedPoolDetailMutations['patchMember']>[0];

const mutationResults = {
    patchMember: [] as QualifiedConnectedAccountUiGroup[],
    addMember: [] as QualifiedConnectedAccountUiGroup[],
    removeMember: [] as QualifiedConnectedAccountUiGroup[],
};

const patch = vi.fn<QualifiedPoolDetailMutations['patch']>();
const patchMember = vi.fn<QualifiedPoolDetailMutations['patchMember']>();
const addMember = vi.fn<QualifiedPoolDetailMutations['addMember']>();
const removeMember = vi.fn<QualifiedPoolDetailMutations['removeMember']>();
const setActiveAccount = vi.fn<QualifiedPoolDetailMutations['setActiveAccount']>();
const deleteGroup = vi.fn<QualifiedPoolDetailMutations['delete']>();

function createMutations(): QualifiedPoolDetailMutations {
    return {
        mutating: false,
        patch,
        patchMember,
        addMember,
        removeMember,
        setActiveAccount,
        delete: deleteGroup,
    };
}

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}

async function renderPoolDetail(
    overrides: Partial<QualifiedConnectedAccountUiGroup> = {},
    viewOverrides: Readonly<{
        error?: string | null;
        autoQuotaResetEnabled?: boolean;
        autoDisablePlanInvalidEnabled?: boolean;
        quotaLimitSelectionEnabled?: boolean;
        quotaSnapshots?: ReadonlyArray<ConnectedServiceQuotaSnapshotV1>;
        quotaEnabledMemberCount?: number;
        quotaLoadingMemberCount?: number;
        onShareWithTeam?: () => void;
    }> = {},
) {
    const group = createGroup(overrides);
    const screen = await renderScreen(
        <QualifiedPoolDetailView
            group={group}
            accounts={ACCOUNTS}
            serviceLabel="Codex"
            mutations={createMutations()}
            error={viewOverrides.error ?? null}
            autoQuotaResetEnabled={viewOverrides.autoQuotaResetEnabled}
            autoDisablePlanInvalidEnabled={viewOverrides.autoDisablePlanInvalidEnabled}
            quotaLimitSelectionEnabled={viewOverrides.quotaLimitSelectionEnabled}
            quotaSnapshots={viewOverrides.quotaSnapshots}
            quotaEnabledMemberCount={viewOverrides.quotaEnabledMemberCount}
            quotaLoadingMemberCount={viewOverrides.quotaLoadingMemberCount}
            onShareWithTeam={viewOverrides.onShareWithTeam}
        />,
    );
    await flush(2);
    return { screen, group };
}

type MemberBlockProps = Readonly<{
    account: QualifiedConnectedAccountRef;
    title?: string;
    identityLabel?: string | null;
    variant?: string;
    groupId?: string | null;
    enabled?: boolean;
    onToggleEnabled?: (next: boolean) => void;
    isActive?: boolean;
    onSetActive?: () => void;
    reorderGesture?: unknown;
    actions?: ReadonlyArray<{ id: string; disabled?: boolean; onPress?: () => void }>;
}>;

type Screen = Awaited<ReturnType<typeof renderPoolDetail>>['screen'];

function memberBlocks(screen: Screen): MemberBlockProps[] {
    return screen.root
        .findAllByType('QualifiedAccountBlock' as never)
        .map((node) => node.props as MemberBlockProps);
}

function memberBlock(screen: Screen, accountId: string): MemberBlockProps {
    const block = memberBlocks(screen).find((candidate) => candidate.account.accountId === accountId);
    if (!block) throw new Error(`no member block for "${accountId}"`);
    return block;
}

function memberAction(screen: Screen, accountId: string, suffix: string) {
    const action = memberBlock(screen, accountId).actions
        ?.find((candidate) => candidate.id.endsWith(`:${suffix}`));
    if (!action) throw new Error(`no "${suffix}" action for "${accountId}"`);
    return action;
}

function dropdownByTriggerTestId(screen: Screen, testID: string): ReactTestInstance {
    const node = screen.root
        .findAllByType('DropdownMenu' as never)
        .find((candidate) => candidate.props.itemTrigger?.itemProps?.testID === testID);
    if (!node) throw new Error(`no dropdown with trigger testID "${testID}"`);
    return node;
}

/** The membership multi-select is the only menu that stays open across selections. */
function membersDropdown(screen: Screen): ReactTestInstance {
    const node = screen.root
        .findAllByType('DropdownMenu' as never)
        .find((candidate) => candidate.props.closeOnSelect === false);
    if (!node) throw new Error('no members multi-select dropdown');
    return node;
}

function switchByTestId(screen: Screen, testID: string): ReactTestInstance {
    const node = screen.root
        .findAllByType('Switch' as never)
        .find((candidate) => candidate.props.testID === testID);
    if (!node) throw new Error(`no switch with testID "${testID}"`);
    return node;
}

async function press(target: { onPress?: () => void } | null | undefined): Promise<void> {
    await act(async () => {
        target?.onPress?.();
    });
    await flush();
}

async function pressRow(screen: Screen, testID: string): Promise<void> {
    await act(async () => {
        screen.pressByTestId(testID);
    });
    await flush();
}

async function expandAdvanced(screen: Screen): Promise<void> {
    await pressRow(screen, 'connected-services-pool-detail:advanced:header');
}

beforeEach(() => {
    modalSpies.prompt.mockReset();
    modalSpies.confirm.mockReset();
    modalSpies.alert.mockReset();
    modalSpies.prompt.mockResolvedValue(null);
    modalSpies.confirm.mockResolvedValue(false);
    modalSpies.alert.mockResolvedValue(undefined);
    mutationResults.patchMember = [];
    mutationResults.addMember = [];
    mutationResults.removeMember = [];
    patch.mockReset();
    patch.mockImplementation(async ({ group, displayName, policy: policyPatch }) => ({
        ...group,
        ...(displayName === undefined ? null : { displayName }),
        ...(policyPatch ? { policy: { ...group.policy, ...policyPatch } } : null),
    }));
    patchMember.mockReset();
    patchMember.mockImplementation(async ({ group, account, enabled, priority }: PatchMemberInput) => {
        const next: QualifiedConnectedAccountUiGroup = {
            ...group,
            members: group.members.map((member) => (
                member.ref.accountId === account.accountId
                    ? {
                        ...member,
                        ...(enabled === undefined ? null : { enabled }),
                        ...(priority === undefined ? null : { priority }),
                    }
                    : member
            )),
        };
        mutationResults.patchMember.push(next);
        return next;
    });
    addMember.mockReset();
    addMember.mockImplementation(async ({ group, account }) => {
        const next: QualifiedConnectedAccountUiGroup = {
            ...group,
            members: [
                ...group.members,
                { ref: account, priority: (group.members.length + 1) * 100, enabled: true, state: {} },
            ],
        };
        mutationResults.addMember.push(next);
        return next;
    });
    removeMember.mockReset();
    removeMember.mockImplementation(async ({ group, account }) => {
        const next: QualifiedConnectedAccountUiGroup = {
            ...group,
            members: group.members.filter((member) => member.ref.accountId !== account.accountId),
        };
        mutationResults.removeMember.push(next);
        return next;
    });
    setActiveAccount.mockReset();
    setActiveAccount.mockImplementation(async ({ group, account }) => ({
        ...group,
        activeAccountId: account.accountId,
    }));
    deleteGroup.mockReset();
    deleteGroup.mockResolvedValue(true);
});

describe('QualifiedPoolDetailView', () => {
    it('keeps provider allowance names, deduplicates windows, and reports enabled-member coverage', () => {
        const candidates = buildPoolQuotaLimitCandidates({
            enabledMemberCount: 3,
            selectedProviderLimitIds: ['iguana_necktie', 'saved-but-unreported'],
            snapshots: [
                {
                    v: 1,
                    serviceId: 'openai-codex',
                    profileId: 'work',
                    fetchedAt: 1_000,
                    staleAfterMs: 60_000,
                    planLabel: null,
                    accountLabel: null,
                    meters: [
                        {
                            meterId: 'spark:primary', label: 'Spark · Primary', providerLimitId: 'spark', modelId: 'gpt-spark',
                            windowDurationMs: 5 * 60 * 60_000,
                            used: null, limit: null, unit: 'unknown', utilizationPct: 10, resetsAt: null, status: 'ok', details: {},
                        },
                        {
                            meterId: 'spark:secondary', label: 'Spark · Secondary', providerLimitId: 'spark', modelId: 'gpt-spark',
                            windowDurationMs: 7 * 24 * 60 * 60_000,
                            used: null, limit: null, unit: 'unknown', utilizationPct: 20, resetsAt: null, status: 'ok', details: {},
                        },
                        {
                            meterId: 'seven_day_fable', label: 'Weekly (Fable)', providerLimitId: 'seven_day_fable', modelId: null,
                            used: null, limit: null, unit: 'unknown', utilizationPct: 30, resetsAt: null, status: 'ok', details: { rawScope: 'weekly_scoped' },
                        },
                        {
                            meterId: 'iguana_necktie', label: 'Unknown', providerLimitId: 'iguana_necktie', modelId: null,
                            used: null, limit: null, unit: 'unknown', utilizationPct: 40, resetsAt: null, status: 'ok', details: {},
                        },
                        {
                            meterId: 'legacy-session', label: 'Legacy session', modelId: null,
                            used: null, limit: null, unit: 'unknown', utilizationPct: 50, resetsAt: null, status: 'ok', details: {},
                        },
                    ],
                },
                {
                    v: 1,
                    serviceId: 'openai-codex',
                    profileId: 'backup',
                    fetchedAt: 1_000,
                    staleAfterMs: 60_000,
                    planLabel: null,
                    accountLabel: null,
                    meters: [{
                        meterId: 'spark:primary', label: 'Spark · Primary', providerLimitId: 'spark', modelId: 'gpt-spark',
                        windowDurationMs: 5 * 60 * 60_000,
                        used: null, limit: null, unit: 'unknown', utilizationPct: 15, resetsAt: null, status: 'ok', details: {},
                    }],
                },
            ],
        });

        expect(candidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                providerLimitId: 'spark',
                title: 'Spark',
                modelIds: ['gpt-spark'],
                windowCount: 2,
                windowSummary: '5h + 7d',
                reportingMemberCount: 2,
                enabledMemberCount: 3,
            }),
            expect.objectContaining({
                providerLimitId: 'seven_day_fable',
                title: 'Weekly (Fable)',
                windowCount: 1,
                reportingMemberCount: 1,
            }),
            expect.objectContaining({
                providerLimitId: 'iguana_necktie',
                title: 'connectedServices.detail.groupDetail.quotaLimitProviderAllowanceTitle',
                technicalId: 'iguana_necktie',
            }),
            expect.objectContaining({
                providerLimitId: 'saved-but-unreported',
                technicalId: 'saved-but-unreported',
                unavailable: true,
                reportingMemberCount: 0,
            }),
            expect.objectContaining({
                providerLimitId: 'legacy-session',
                title: 'Legacy session',
                reportingMemberCount: 1,
            }),
        ]));
        expect(candidates.filter((candidate) => candidate.providerLimitId === 'spark')).toHaveLength(1);
    });

    it('authors one nonempty custom quota-family selection and preserves unavailable saved limits', async () => {
        const { screen } = await renderPoolDetail({
            policy: policy({
                quotaLimitSelection: { mode: 'selected', providerLimitIds: ['legacy-limit'] },
            }),
        }, {
            quotaLimitSelectionEnabled: true,
            quotaSnapshots: [{
                v: 1,
                serviceId: 'openai-codex',
                profileId: 'work',
                fetchedAt: 1_000,
                staleAfterMs: 60_000,
                planLabel: null,
                accountLabel: null,
                meters: [{
                    meterId: 'spark:primary',
                    label: 'Spark · Primary',
                    providerLimitId: 'spark',
                    used: null,
                    limit: null,
                    unit: 'unknown',
                    utilizationPct: 10,
                    resetsAt: null,
                    status: 'ok',
                    details: {},
                }],
            }],
        });
        const menu = screen.root
            .findAllByType('DropdownMenu' as never)
            .find((candidate) => candidate.props.items?.some((item: { title?: string }) => (
                item.title === 'connectedServices.detail.groupDetail.quotaLimitsAllTitle'
            )));
        expect(menu?.props.items).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'spark', title: 'Spark' }),
            expect.objectContaining({
                id: 'legacy-limit',
                subtitle: expect.stringMatching(
                    /quotaLimitUnavailableSubtitle.*quotaLimitTechnicalIdSubtitle/,
                ),
            }),
        ]));

        await act(async () => menu?.props.onOpenChange(true));
        await act(async () => menu?.props.onSelect('legacy-limit'));
        await act(async () => menu?.props.onOpenChange(false));
        expect(patch).not.toHaveBeenCalled();

        await act(async () => menu?.props.onOpenChange(true));
        await act(async () => menu?.props.onSelect('spark'));
        await act(async () => menu?.props.onOpenChange(false));
        expect(patch).toHaveBeenCalledWith(expect.objectContaining({
            policy: expect.objectContaining({
                quotaLimitSelection: { mode: 'selected', providerLimitIds: ['legacy-limit', 'spark'] },
            }),
        }));
    });

    it('does not expose quota policy authoring when the negotiated feature is absent', async () => {
        const { screen } = await renderPoolDetail();
        expect(screen.root.findAllByType('DropdownMenu' as never).some(
            (candidate) => candidate.props.items?.some((item: { title?: string }) => (
                item.title === 'connectedServices.detail.groupDetail.quotaLimitsAllTitle'
            )),
        )).toBe(false);
    });

    it('marks the reported-limit inventory incomplete while enabled member quotas load', async () => {
        const { screen } = await renderPoolDetail({}, {
            quotaLimitSelectionEnabled: true,
            quotaEnabledMemberCount: 2,
            quotaLoadingMemberCount: 1,
        });
        const menu = screen.root
            .findAllByType('DropdownMenu' as never)
            .find((candidate) => candidate.props.items?.some((item: { title?: string }) => (
                item.title === 'connectedServices.detail.groupDetail.quotaLimitsAllTitle'
            )));
        expect(menu?.props.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: ' ',
                subtitle: 'connectedServices.detail.groupDetail.quotaLimitsAllLoadingSubtitle',
            }),
        ]));
    });

    it('offers the current Pool to a Team through the mounted source action', async () => {
        const onShareWithTeam = vi.fn();
        const { screen } = await renderPoolDetail({}, { onShareWithTeam });

        screen.pressByTestId('connected-services-pool-detail:share-with-team');

        expect(onShareWithTeam).toHaveBeenCalledTimes(1);
    });

    it('offers explicit quota-reset spending only when the owning service and server support it', async () => {
        const { screen } = await renderPoolDetail({}, { autoQuotaResetEnabled: true });
        const toggle = screen.findByTestId('connected-services-pool-detail:auto-quota-reset:toggle');
        expect(toggle).toBeTruthy();
        expect(toggle?.props.value).toBe(false);
        await act(async () => { await toggle?.props.onValueChange(true); });
        expect(patch).toHaveBeenCalledWith(expect.objectContaining({
            policy: expect.objectContaining({ autoUseQuotaResetsWhenExhausted: true }),
        }));
    });

    it('fails closed when quota-reset support is absent', async () => {
        const { screen } = await renderPoolDetail();
        expect(screen.findByTestId('connected-services-pool-detail:auto-quota-reset:toggle')).toBeNull();
    });

    it('offers opt-in model-entitlement auto-disable only when the server enables it', async () => {
        const { screen } = await renderPoolDetail({}, { autoDisablePlanInvalidEnabled: true });
        const toggle = screen.findByTestId('connected-services-pool-detail:auto-disable-plan-invalid:toggle');
        expect(toggle?.props.value).toBe(false);
        await act(async () => { await toggle?.props.onValueChange(true); });
        expect(patch).toHaveBeenCalledWith(expect.objectContaining({
            policy: expect.objectContaining({ autoDisablePlanInvalidAccounts: true }),
        }));

        const unavailable = await renderPoolDetail();
        expect(unavailable.screen.findByTestId('connected-services-pool-detail:auto-disable-plan-invalid:toggle')).toBeNull();
    });
    it('renders members as pool-member account blocks in priority order', async () => {
        const { screen, group } = await renderPoolDetail();

        const blocks = memberBlocks(screen);
        expect(blocks.map((block) => block.account.accountId)).toEqual(['work', 'backup']);
        for (const block of blocks) {
            expect(block.variant).toBe('poolMember');
            expect(block.groupId).toBe(group.ref.groupId);
        }
        expect(memberBlock(screen, 'work').isActive).toBe(true);
        expect(memberBlock(screen, 'backup').isActive).toBe(false);
        // Two members means reorder is live: each row carries a drag gesture.
        expect(memberBlock(screen, 'work').reorderGesture).toBeTruthy();
    });

    it('shows why a model-ineligible member was disabled automatically', async () => {
        const { screen } = await renderPoolDetail({
            members: [
                {
                    ref: accountRef('work'),
                    priority: 100,
                    enabled: false,
                    state: { autoDisabledReason: 'model_not_entitled' },
                },
            ],
        });

        expect(memberBlock(screen, 'work').identityLabel).toBe(
            'connectedServices.detail.groups.memberAutoDisabledModelNotEntitled',
        );
    });

    it('names a member by its human identity and keeps the remaining identity facts on the identity line', async () => {
        const { screen } = await renderPoolDetail();
        // No user label: the provider email names the account (the plugin display
        // name only wins when there is no email), so a pool member reads exactly as
        // the same account reads on the accounts list. The canonical account id
        // keys the row and never appears on either line.
        expect(memberBlock(screen, 'work').title).toBe('work@example.com');
        expect(memberBlock(screen, 'work').identityLabel).toBe('Codex');

        const labelled = await renderScreen(
            <QualifiedPoolDetailView
                group={createGroup()}
                accounts={ACCOUNTS}
                accountLabels={{ work: 'Primary' }}
                serviceLabel="Codex"
                mutations={createMutations()}
            />,
        );
        await flush(2);
        expect(memberBlock(labelled, 'work').title).toBe('Primary');
        expect(memberBlock(labelled, 'work').identityLabel).toBe('Codex · work@example.com');
    });

    it('falls back to the provider email, never the raw account id, for an account with no name', async () => {
        const screen = await renderScreen(
            <QualifiedPoolDetailView
                group={createGroup()}
                accounts={[
                    { ref: accountRef('work'), providerIdentity: { email: 'work@example.com' }, status: 'connected' },
                    { ref: accountRef('backup'), status: 'connected' },
                ]}
                serviceLabel="Codex"
                mutations={createMutations()}
            />,
        );
        await flush(2);

        expect(memberBlock(screen, 'work').title).toBe('work@example.com');
        expect(memberBlock(screen, 'work').identityLabel).toBe('Codex');
        // Nothing recognisable exists for `backup`, so the service title remains
        // the primary label and the identity line stays empty. The opaque id is
        // NOT a fallback: it keys the row, and a user cannot recognise an
        // account by it on screen or through a screen reader.
        expect(memberBlock(screen, 'backup').title).toBe('Codex');
        expect(memberBlock(screen, 'backup').identityLabel ?? '').not.toContain('backup');
    });

    it('offers each membership candidate with its name and identity line', async () => {
        const { screen } = await renderPoolDetail();

        const options = membersDropdown(screen).props.items as ReadonlyArray<{
            id: string;
            title: string;
            subtitle?: string;
        }>;
        // The canonical id keys each option for the mutation and appears nowhere
        // in the title or subtitle a person reads.
        expect(options.map((option) => option.id)).toEqual(['work', 'backup', 'spare']);
        expect(options[0]).toMatchObject({ title: 'work@example.com', subtitle: 'Codex' });
        expect(options[1]).toMatchObject({ title: 'backup@example.com', subtitle: 'Codex' });
    });

    it('toggling a member enable switch patches that member', async () => {
        const { screen, group } = await renderPoolDetail();

        await act(async () => {
            memberBlock(screen, 'backup').onToggleEnabled?.(false);
        });
        await flush();

        expect(patchMember).toHaveBeenCalledTimes(1);
        expect(patchMember.mock.calls[0]?.[0]).toMatchObject({
            group,
            account: { accountId: 'backup' },
            enabled: false,
        });
    });

    it('moving a member down writes spaced priorities in sequence, threading the returned group', async () => {
        const { screen, group } = await renderPoolDetail();

        await press(memberAction(screen, 'work', 'move-down'));

        expect(patchMember).toHaveBeenCalledTimes(2);
        const [first, second] = patchMember.mock.calls.map((call) => call[0]);
        expect(first).toMatchObject({ account: { accountId: 'backup' }, priority: 100 });
        expect(second).toMatchObject({ account: { accountId: 'work' }, priority: 200 });
        // The first call runs against the incoming group; the second against the
        // group the first call RETURNED (dev's sequential-mutation idiom).
        expect(first?.group).toBe(group);
        expect(second?.group).toBe(mutationResults.patchMember[0]);
    });

    it('shows the dropped order immediately, before the priority patches land', async () => {
        const { screen } = await renderPoolDetail();
        let releaseFirstPatch: (() => void) | null = null;
        patchMember.mockImplementationOnce(async ({ group, account, priority }: PatchMemberInput) => {
            await new Promise<void>((resolve) => { releaseFirstPatch = resolve; });
            return {
                ...group,
                members: group.members.map((member) => (
                    member.ref.accountId === account.accountId && priority !== undefined
                        ? { ...member, priority }
                        : member
                )),
            };
        });

        await press(memberAction(screen, 'work', 'move-down'));

        // The group prop has NOT changed yet — the new order is the local,
        // atomic optimistic reprice, not a server round-trip.
        expect(memberBlocks(screen).map((block) => block.account.accountId))
            .toEqual(['backup', 'work']);

        await act(async () => {
            releaseFirstPatch?.();
        });
        await flush();
    });

    it('stops the reorder sequence when a member patch fails', async () => {
        const { screen } = await renderPoolDetail();
        patchMember.mockResolvedValueOnce(null);

        await press(memberAction(screen, 'work', 'move-down'));

        expect(patchMember).toHaveBeenCalledTimes(1);
    });

    it('disables move-up on the first member and move-down on the last', async () => {
        const { screen } = await renderPoolDetail();

        expect(memberAction(screen, 'work', 'move-up').disabled).toBe(true);
        expect(memberAction(screen, 'backup', 'move-down').disabled).toBe(true);
        expect(memberAction(screen, 'work', 'move-down').disabled).toBe(false);
    });

    it('making a member active calls setActiveAccount', async () => {
        const { screen, group } = await renderPoolDetail();

        await press(memberAction(screen, 'backup', 'set-active'));

        expect(setActiveAccount).toHaveBeenCalledTimes(1);
        expect(setActiveAccount.mock.calls[0]?.[0]).toMatchObject({
            group,
            account: { accountId: 'backup' },
        });
    });

    it('exposes the leading radio affordance for a non-active member only', async () => {
        const { screen } = await renderPoolDetail();

        expect(memberBlock(screen, 'work').onSetActive).toBeUndefined();
        await act(async () => {
            memberBlock(screen, 'backup').onSetActive?.();
        });
        await flush();

        expect(setActiveAccount).toHaveBeenCalledTimes(1);
    });

    it('confirms before removing a member and does not remove when declined', async () => {
        const { screen } = await renderPoolDetail();

        await press(memberAction(screen, 'backup', 'remove'));

        expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
        expect(removeMember).not.toHaveBeenCalled();

        modalSpies.confirm.mockResolvedValue(true);
        await press(memberAction(screen, 'backup', 'remove'));

        expect(removeMember).toHaveBeenCalledTimes(1);
        expect(removeMember.mock.calls[0]?.[0]).toMatchObject({ account: { accountId: 'backup' } });
    });

    it('renders the shared membership multi-select seeded with current members', async () => {
        const { screen } = await renderPoolDetail();

        const dropdown = membersDropdown(screen);
        expect(dropdown.props.items.map((item: { id: string }) => item.id))
            .toEqual(['work', 'backup', 'spare']);

        await act(async () => {
            dropdown.props.onOpenChange?.(true);
        });
        await act(async () => {
            membersDropdown(screen).props.onSelect?.('spare');
        });
        await act(async () => {
            membersDropdown(screen).props.onOpenChange?.(false);
        });
        await flush();

        expect(addMember).toHaveBeenCalledTimes(1);
        expect(addMember.mock.calls[0]?.[0]).toMatchObject({ account: { accountId: 'spare' } });
    });

    it('renders the header summary and the server-active status row', async () => {
        const { screen } = await renderPoolDetail();

        expect(screen.findByTestId('connected-services-pool-detail:summary')).not.toBeNull();
        expect(screen.findByTestId('connected-services-pool-detail:server-active-status')).not.toBeNull();
    });

    it('names a pool whose display name is only whitespace by its author service title', async () => {
        // A blank name must never render as an empty row title or promote the
        // opaque pool id into the primary presentation.
        const { screen } = await renderPoolDetail({ displayName: '   ' });

        const nameRow = screen.find((node) => (
            node.props?.testID === 'connected-services-pool-detail:name'
            && typeof node.props?.subtitle === 'string'
        ));
        expect(nameRow.props.subtitle).toBe('Codex');
    });

    it('omits the server-active status row when the pool has no active account', async () => {
        const { screen } = await renderPoolDetail({ activeAccountId: null });

        expect(screen.findByTestId('connected-services-pool-detail:server-active-status')).toBeNull();
    });

    it('renames the pool through a prompt', async () => {
        const { screen, group } = await renderPoolDetail();
        modalSpies.prompt.mockResolvedValue('  Renamed pool  ');

        await pressRow(screen, 'connected-services-pool-detail:name');

        expect(patch).toHaveBeenCalledTimes(1);
        expect(patch.mock.calls[0]?.[0]).toMatchObject({ group, displayName: 'Renamed pool' });
    });

    it('patches automatic fallback, strategy and the soft-switch threshold', async () => {
        const { screen, group } = await renderPoolDetail();

        await act(async () => {
            switchByTestId(screen, 'connected-services-pool-detail:auto-switch:toggle')
                .props.onValueChange?.(true);
        });
        await flush();
        expect(patch.mock.calls[0]?.[0]).toMatchObject({ group, policy: { autoSwitch: true } });

        await act(async () => {
            dropdownByTriggerTestId(screen, 'connected-services-pool-detail:strategy')
                .props.onSelect?.('manual');
        });
        await flush();
        expect(patch.mock.calls[1]?.[0]).toMatchObject({ policy: { strategy: 'manual' } });

        modalSpies.prompt.mockResolvedValue('25');
        await pressRow(screen, 'connected-services-pool-detail:soft-switch-threshold');
        expect(patch.mock.calls[2]?.[0]).toMatchObject({ policy: { softSwitchRemainingPercent: 25 } });
    });

    it('rejects an out-of-range soft-switch threshold without patching', async () => {
        const { screen } = await renderPoolDetail();
        modalSpies.prompt.mockResolvedValue('180');

        await pressRow(screen, 'connected-services-pool-detail:soft-switch-threshold');

        expect(modalSpies.alert).toHaveBeenCalledTimes(1);
        expect(patch).not.toHaveBeenCalled();
    });

    it('patches every advanced policy control', async () => {
        const { screen } = await renderPoolDetail();
        await expandAdvanced(screen);

        await act(async () => {
            switchByTestId(screen, 'connected-services-pool-detail:auto-restore-primary:toggle')
                .props.onValueChange?.(true);
        });
        await flush();
        expect(patch.mock.calls.at(-1)?.[0]).toMatchObject({
            policy: { autoRestorePrimaryWhenReset: true },
        });

        for (const key of ['usageLimit', 'authExpired', 'accountChanged', 'refreshFailure'] as const) {
            const current = createGroup().policy.switchOn[key];
            await act(async () => {
                switchByTestId(screen, `connected-services-pool-detail:switch-on:${key}:toggle`)
                    .props.onValueChange?.(!current);
            });
            await flush();
            expect(patch.mock.calls.at(-1)?.[0]).toMatchObject({
                policy: { switchOn: { ...createGroup().policy.switchOn, [key]: !current } },
            });
        }

        modalSpies.prompt.mockResolvedValue('10');
        await pressRow(screen, 'connected-services-pool-detail:stale-probe-after');
        expect(patch.mock.calls.at(-1)?.[0]).toMatchObject({
            policy: { probeIfSnapshotOlderThanMs: 600_000 },
        });

        await act(async () => {
            dropdownByTriggerTestId(screen, 'connected-services-pool-detail:recovery-mode')
                .props.onSelect?.('off');
        });
        await flush();
        expect(patch.mock.calls.at(-1)?.[0]).toMatchObject({ policy: { recoveryMode: 'off' } });

        expect(screen.findByTestId('connected-services-pool-detail:switch-budget')).not.toBeNull();
        expect(screen.findByTestId('connected-services-pool-detail:recovery-prompt')).not.toBeNull();
    });

    it('keeps the advanced controls collapsed until the disclosure is opened', async () => {
        const { screen } = await renderPoolDetail();

        expect(screen.findByTestId('connected-services-pool-detail:switch-budget')).toBeNull();

        await expandAdvanced(screen);

        expect(screen.findByTestId('connected-services-pool-detail:switch-budget')).not.toBeNull();
    });

    it('confirms before deleting the pool', async () => {
        const { screen, group } = await renderPoolDetail();

        await pressRow(screen, 'connected-services-pool-detail:delete');
        expect(modalSpies.confirm).toHaveBeenCalledTimes(1);
        expect(deleteGroup).not.toHaveBeenCalled();

        modalSpies.confirm.mockResolvedValue(true);
        await pressRow(screen, 'connected-services-pool-detail:delete');
        expect(deleteGroup).toHaveBeenCalledWith(group);
    });

    it('disables the fallback controls when automatic fallback is unavailable', async () => {
        const group = createGroup();
        const screen = await renderScreen(
            <QualifiedPoolDetailView
                group={group}
                accounts={ACCOUNTS}
                serviceLabel="Codex"
                mutations={createMutations()}
                fallbackControlsEnabled={false}
                fallbackDisabledSubtitle="unsupported"
            />,
        );
        await flush(2);

        expect(
            switchByTestId(screen, 'connected-services-pool-detail:auto-switch:toggle').props.disabled,
        ).toBe(true);
        await act(async () => {
            switchByTestId(screen, 'connected-services-pool-detail:auto-switch:toggle')
                .props.onValueChange?.(true);
        });
        await flush();
        expect(patch).not.toHaveBeenCalled();
    });

    it('renders an empty-members row when the pool has no members', async () => {
        const { screen } = await renderPoolDetail({ members: [], activeAccountId: null });

        expect(memberBlocks(screen)).toHaveLength(0);
        expect(screen.findByTestId('connected-services-pool-detail:no-members')).not.toBeNull();
    });

    it('surfaces a failed mutation instead of letting the change fail silently', async () => {
        // The mutation owner reports failure by returning null and setting its
        // error. Without a slot for it the pool would simply reconcile back to
        // server state, leaving the user to infer that anything went wrong.
        const { screen } = await renderPoolDetail({}, { error: 'connect_group_generation_conflict' });

        // The row's testID lands on both the Item and its host view; the Item is
        // the one carrying the message.
        const errorRow = screen.root
            .findAll((node) => node.props?.testID === 'connected-services-pool-detail:error')
            .find((node) => typeof node.props?.subtitle === 'string');
        expect(errorRow?.props.subtitle).toBe('connect_group_generation_conflict');
    });

    it('renders no error row when the mutation owner reports none', async () => {
        const { screen } = await renderPoolDetail();

        expect(screen.root.findAll((node) => (
            node.props?.testID === 'connected-services-pool-detail:error'
        ))).toHaveLength(0);
    });
});
