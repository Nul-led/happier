import { hostname } from 'node:os';

import { spawnHappyCLI } from '@/utils/spawnHappyCLI';

import type { CommandContext } from '@/cli/commandRegistry';
import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import {
    cmd,
    createOutputBuilder,
    errorFrame,
    neutral,
    ok,
    createSetupChoicePrompt,
    renderSetupWelcome,
    renderHelpPage,
    warn,
    type HelpPageOptions,
} from '@happier-dev/cli-common/output';
import { isInteractiveTerminal, promptInput } from '@/terminal/prompts/promptInput';
import { promptMultipleChoice } from '@/terminal/prompts/promptMultipleChoice';
import { runCliAccountServiceSetupEntry } from '@/auth/accountService/cliAccountServiceSetupEntry';
import { isLoopbackServerHost } from '@/server/serverUrlClassification';
import { readSettings, readStoredCredentials } from '@/persistence';
import { resolveActiveServerAuthReadiness } from '@/auth/resolveActiveServerAuthReadiness';
import { configuration, reloadConfiguration } from '@/configuration';
import {
    applyResolvedServerSelectionNonFocusing,
    applyServerSelectionFromArgs,
    prepareServerSelectionFromArgs,
    resolveServerSelectionFromArgs,
} from '@/server/serverSelection';
import { resolveCliHomeTarget, resolveCurrentCliHomeTarget } from '@/server/homeTarget';
import {
    parseCliHomeTargetArgs,
    projectCliHomeTargetToServerSelectionArgs,
} from '@/server/homeTargetCliArgs';
import { adoptServerProfileHomeConnectionDescriptor, useServerProfile } from '@/server/serverProfiles';
import {
    syncInstalledFirstPartyShims,
    writeDefaultManagedReleaseChannel,
} from '@happier-dev/cli-common/firstPartyRuntime';
import { DEFAULT_HAPPIER_CLOUD_SERVER_URL } from '@happier-dev/cli-common/happierCloud';
import { AGENTS_CORE, getAgentCliSetupRecommendedIds } from '@happier-dev/agents';
import { resolvePublicReleaseRingIdForLabel } from '@happier-dev/release-runtime/releaseRings';
import {
    buildSetupPlan,
    decideSetupReadiness,
} from './setupDecision';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import {
    readBackgroundServiceSetupGuidance,
    resolveBackgroundServiceSetupGuidance,
    resolveBackgroundServiceSetupReconciliationDisposition,
    type BackgroundServiceSetupGuidance,
    formatBackgroundServiceReleaseChannelSwitchPrompt,
    formatBackgroundServiceManualRelayTakeoverPrompt,
    formatBackgroundServiceReplacementPrompt,
} from '@happier-dev/cli-common/systemTasks';

function buildSetupHelpPage(): HelpPageOptions {
    const recommendedProviderIds = getAgentCliSetupRecommendedIds();
    const providerExample = recommendedProviderIds.length > 0
        ? `happier setup --home-url https://home.example.test ${recommendedProviderIds.map((id) => `--provider ${id}`).join(' ')}`
        : 'happier setup --home-url https://home.example.test --provider <id>';
    return {
        title: 'setup',
        subtitle: 'Choose or create a Home for this computer',
        usage: [
            {
                label: cmd('happier setup [--home <saved>] [--home-url <https-url>] [--home-descriptor-file <path|->] [--provider <id> ...] [--skip-daemon] [--skip-providers] [--yes|--non-interactive]'),
                description: 'Finds linked Homes, connects to an existing Home, or creates a Personal Home here.',
            },
            {
                label: cmd('happier setup plan [--home <saved>|--home-url <url>|--home-descriptor-file <path|->] [--json]'),
                description: 'Prints the planned steps without running them.',
            },
        ],
        sections: [
            {
                title: 'Examples:',
                rows: [
                    { label: cmd('happier setup --home-url https://home.example.test'), description: '' },
                    { label: cmd('happier setup --home-descriptor-file ./home.json'), description: '' },
                    { label: cmd(providerExample), description: '' },
                    { label: cmd('happier setup plan --home-url https://home.example.test'), description: '' },
                ],
            },
        ],
        notes: [
            'Connects this computer to a Home (Home selection → auth → background service → agents).',
            'With no usable active Home, choose whether to find linked Homes through your sign-in service, connect directly, or create a Personal Home here.',
            'Finding linked Homes is recommended and uses the independently selected sign-in service (Happier Cloud by default).',
            'Pass --home, --home-url, or --home-descriptor-file to connect directly and skip that choice.',
            'A strict descriptor can reach an Iroh-only Home without a public HTTPS address.',
            '--yes adopts an explicitly named Home, then exits incomplete before interactive continuation. --non-interactive changes nothing.',
        ],
    };
}

function takeFlag(args: readonly string[], flag: string): Readonly<{ present: boolean; rest: string[] }> {
    const rest: string[] = [];
    let present = false;
    for (const arg of args) {
        if (arg === flag) {
            present = true;
            continue;
        }
        rest.push(arg);
    }
    return { present, rest };
}

function takeRepeatedFlagValues(args: readonly string[], flag: string): Readonly<{ values: string[]; rest: string[] }> {
    const rest: string[] = [];
    const values: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const current = String(args[index] ?? '');
        if (current === flag) {
            const next = String(args[index + 1] ?? '');
            if (!next || next.startsWith('--')) {
                throw new Error(`Missing value for ${flag}`);
            }
            values.push(next);
            index += 1;
            continue;
        }
        rest.push(current);
    }
    return { values, rest };
}

function parseSetupExecutionOptions(args: readonly string[]): Readonly<{
    skipDaemon: boolean;
    skipProviders: boolean;
    providers: readonly string[];
    yes: boolean;
}> {
    const { present: skipDaemon, rest: withoutSkipDaemon } = takeFlag(args, '--skip-daemon');
    const { present: skipProviders, rest: withoutSkipProviders } = takeFlag(withoutSkipDaemon, '--skip-providers');
    const { values: providers, rest: remaining } = takeRepeatedFlagValues(withoutSkipProviders, '--provider');
    const { present: yes, rest: withoutYes } = takeFlag(remaining, '--yes');
    const { rest: withoutJson } = takeFlag(withoutYes, '--json');
    const { rest: withoutNonInteractive } = takeFlag(withoutJson, '--non-interactive');
    if (withoutNonInteractive.length > 0) {
        throw new Error(`Unknown setup arguments: ${withoutNonInteractive.join(' ')}`);
    }
    return { skipDaemon, skipProviders, providers, yes };
}

function normalizeRelayUrl(raw: string): string {
    return raw.trim().replace(/\/+$/u, '');
}

function createSetupSubmenuPrompt(options: Readonly<{
    question: string;
    description?: string;
    choices: Parameters<typeof createSetupChoicePrompt>[0]['choices'];
}>) {
    return createSetupChoicePrompt({
        machineName: '',
        subtitle: '',
        showWelcome: false,
        ...options,
    });
}

async function promptForExistingHomeTargetArgs(
    promptInputFn: typeof promptInput,
): Promise<readonly string[] | null> {
    const connectionPrompt = createSetupSubmenuPrompt({
        question: 'How will you connect to the Home?',
        choices: [
            { id: 'saved', key: 's', label: 'Saved Home', isDefault: true },
            { id: 'https', key: 'h', label: 'HTTPS address' },
            { id: 'descriptor', key: 'd', label: 'Home descriptor file', description: 'including Iroh-only Homes' },
            { id: 'exit', key: 'x', label: 'Exit' },
        ],
    });
    const connection = await promptMultipleChoice(
        connectionPrompt.message,
        [
            { id: 'saved', keys: ['s', 'saved', ''], short: 's' },
            { id: 'https', keys: ['h', 'https'], short: 'h' },
            { id: 'descriptor', keys: ['d', 'descriptor'], short: 'd' },
            { id: 'exit', keys: ['x', 'exit'], short: 'x' },
        ] as const,
        {
            defaultId: 'saved',
            maxAttempts: 3,
            promptInputFn,
            ...(connectionPrompt.renderMessage
                ? { animate: connectionPrompt.animate === true, renderMessage: connectionPrompt.renderMessage }
                : {}),
        },
    );
    if (connection === 'exit') return null;

    const prompt = connection === 'saved'
        ? 'Saved Home name: '
        : connection === 'https'
            ? 'Home HTTPS address: '
            : 'Home descriptor file: ';
    const value = (await promptInputFn(prompt)).trim();
    if (!value) return null;
    if (connection === 'saved') return ['--home', value];
    if (connection === 'https') return ['--home-url', value];
    return ['--home-descriptor-file', value];
}

async function runHappyCliStep(
    args: readonly string[],
    opts?: Readonly<{ env?: NodeJS.ProcessEnv; signal?: AbortSignal }>,
): Promise<number> {
    const child = spawnHappyCLI([...args], {
        stdio: 'inherit',
        env: opts?.env,
        signal: opts?.signal,
        shell: false,
    });
    return await new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : 1));
        child.once('error', () => resolve(1));
    });
}

async function runHappyCliStepQuiet(
    args: readonly string[],
    opts?: Readonly<{ env?: NodeJS.ProcessEnv; signal?: AbortSignal }>,
): Promise<number> {
    const child = spawnHappyCLI([...args], { stdio: 'ignore', env: opts?.env, signal: opts?.signal, shell: false });
    return await new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : 1));
        child.once('error', () => resolve(1));
    });
}

/**
 * Agent CLIs from the resolved contribution catalog that actually resolve on
 * this computer. This is loaded at the finish line so setup does not create a
 * bundled-only second catalog or eagerly load the plugin/runtime graph.
 */
async function listInstalledAgentIds(): Promise<readonly string[]> {
    const [{ resolveMergedContributionRegistry }, { resolveAgentCliCommandForRuntime }] = await Promise.all([
        import('@/plugins/projection/registry/createResolvedContributionRegistry'),
        import('@happier-dev/cli-common/agents'),
    ]);
    const registry = await resolveMergedContributionRegistry({ happyHomeDir: configuration.happyHomeDir });
    return registry.agents.filter((agent) => {
        if (!agent.runtimeSpec) return false;
        try {
            return resolveAgentCliCommandForRuntime(agent.runtimeSpec, { processEnv: process.env }) !== null;
        } catch {
            // A resolver failure means "not usable here", which is what we asked.
            return false;
        }
    }).map((agent) => agent.id);
}

/**
 * Happier runs a coding agent and ships none, so a machine that finishes setup
 * without one is paired but unusable — and today that only surfaces later, as a
 * resolver error at the start of the first session. Say it here instead. It
 * never blocks: an agent can be installed afterwards, from this same shell.
 */
function printNoCodingAgentWarning(): void {
    const recommendedIds = getAgentCliSetupRecommendedIds();
    const out = createOutputBuilder();
    out.line(warn('No coding agent found on this computer.'));
    out.blank();
    out.line('Happier runs your coding agent; it does not ship one. Install at least one:');
    if (recommendedIds.length > 0) {
        out.blank();
        for (const agentId of recommendedIds) {
            out.line(`  ${cmd(`happier agents install ${agentId}`)}`);
        }
    }
    out.blank();
    out.line(`  See them all with ${cmd('happier agents list')}, or choose interactively with ${cmd('happier agents setup')}.`);
    out.blank();
    out.line('This computer is connected, but you still need a coding agent before starting a session.');
    out.line('  App: Settings → Agents → CLI & Authentication');
    console.log(out.render());
}

async function printSetupAgentReadiness(
    listInstalledAgentIdsFn: () => Promise<readonly string[]>,
): Promise<void> {
    let installedAgentIds: readonly string[];
    try {
        installedAgentIds = await listInstalledAgentIdsFn();
    } catch {
        // Advisory, so a check that cannot run must not fail a setup that otherwise
        // succeeded — but it must not be silent either.
        const out = createOutputBuilder();
        out.line(neutral(`Could not check which coding agents are installed. Run ${cmd('happier agents list')} to check.`));
        console.log(out.render());
        return;
    }
    if (installedAgentIds.length === 0) {
        printNoCodingAgentWarning();
        return;
    }
    const agentId = installedAgentIds[0]!;
    const cliSubcommand = (AGENTS_CORE as Readonly<Record<string, Readonly<{ cliSubcommand?: string }>>>)[agentId]?.cliSubcommand
        ?? agentId;
    const out = createOutputBuilder();
    out.blank();
    out.line(ok('Computer connected. Coding agent installed.'));
    out.line('Start your first session:');
    out.line(`  App: New session → this computer → choose a project`);
    out.line(`  CLI: ${cmd(`happier ${cliSubcommand}`)}`);
    out.line('Agent installation and sign-in are separate. Manage both in the app:');
    out.line('  Settings → Agents → CLI & Authentication');
    console.log(out.render());
}

type SetupCommandDeps = Readonly<{
    readCredentialsFn?: typeof readStoredCredentials;
    readSettingsFn?: typeof readSettings;
    isInteractiveTerminalFn?: typeof isInteractiveTerminal;
    promptInputFn?: typeof promptInput;
    runHappyCliStepFn?: typeof runHappyCliStep;
    applyServerSelectionFromArgs?: typeof applyServerSelectionFromArgs;
    prepareServerSelectionFromArgsFn?: typeof prepareServerSelectionFromArgs;
    applyResolvedServerSelectionNonFocusingFn?: typeof applyResolvedServerSelectionNonFocusing;
    resolveServerSelectionFromArgs?: typeof resolveServerSelectionFromArgs;
    readBackgroundServiceSetupGuidanceFn?: typeof readBackgroundServiceSetupGuidance;
    writeDefaultManagedReleaseChannelFn?: typeof writeDefaultManagedReleaseChannel;
    syncInstalledFirstPartyShimsFn?: typeof syncInstalledFirstPartyShims;
    listInstalledAgentIdsFn?: () => Promise<readonly string[]>;
    runAccountServiceHomeEntryFn?: typeof runCliAccountServiceSetupEntry;
    readHomeDescriptorTextFn?: (path: string) => Promise<string>;
    parseHomeTargetArgsFn?: typeof parseCliHomeTargetArgs;
    resolveHomeTargetFn?: typeof resolveCliHomeTarget;
    resolveCurrentHomeTargetFn?: typeof resolveCurrentCliHomeTarget;
    adoptHomeDescriptorFn?: typeof adoptServerProfileHomeConnectionDescriptor;
    useHomeProfileFn?: typeof useServerProfile;
    /** Suppresses successful presentation and child output for a composing JSON command. */
    quiet?: boolean;
    /** Trusted composition after Home creation has atomically committed authenticated credentials. */
    invocation?: 'authenticated-home-create-continuation';
}>;

type SetupContinuationOutcome =
    | Readonly<{ kind: 'continued' }>
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{ kind: 'failed'; exitCode: number }>;

async function continueSetupForSelectedHome(input: Readonly<{
    serverUrl: string;
    relaySelectionChanged: boolean;
    includeAuth: boolean;
    forceWebAuthentication: boolean;
    recoverAccountMaterial: boolean;
    execution: ReturnType<typeof parseSetupExecutionOptions>;
    quiet: boolean;
    authenticatedHomeCreateContinuation: boolean;
    isInteractiveTerminalFn: typeof isInteractiveTerminal;
    promptInputFn: typeof promptInput;
    runHappyCliStepFn: typeof runHappyCliStep;
    readBackgroundServiceSetupGuidanceFn: typeof readBackgroundServiceSetupGuidance;
    writeDefaultManagedReleaseChannelFn: typeof writeDefaultManagedReleaseChannel;
    syncInstalledFirstPartyShimsFn: typeof syncInstalledFirstPartyShims;
    listInstalledAgentIdsFn: () => Promise<readonly string[]>;
    initialInstalledAgentIds?: readonly string[];
    onAuthCompleted?: () => Promise<void>;
    signal?: AbortSignal;
}>): Promise<SetupContinuationOutcome> {
    const initialInstalledAgentIds = input.initialInstalledAgentIds
        ?? await input.listInstalledAgentIdsFn().catch(() => []);
    const plan = buildSetupPlan({
        serverUrl: input.serverUrl,
        includeAuth: input.includeAuth,
        forceWebAuthentication: input.forceWebAuthentication,
        includeDaemon: !input.execution.skipDaemon,
        skipProviders: input.execution.skipProviders,
        installedAgentIds: initialInstalledAgentIds,
        providers: input.execution.providers,
        assumeYes: input.execution.yes,
        recoverAccountMaterial: input.recoverAccountMaterial,
    });

    let daemonSteps: readonly Readonly<{ argv: readonly string[]; display: string }>[] = [];
    let applyAcceptedBackgroundServiceGuidance = async (): Promise<void> => undefined;
    if (!input.execution.skipDaemon) {
        const guidance = await input.readBackgroundServiceSetupGuidanceFn({
            targetReleaseChannel: configuration.publicReleaseRing,
            targetServerUrl: input.serverUrl,
        });

        if (
            (
                guidance.shouldOfferDefaultReleaseChannelSwitch
                || guidance.shouldPromptForManualRelayTakeover
                || guidance.shouldPromptForServiceReplacement
            )
            && !input.isInteractiveTerminalFn()
        ) {
            throw new Error('Background service setup requires interactive guidance. Re-run in an interactive terminal or pass --skip-daemon.');
        }

        const guidanceDecision = await resolveBackgroundServiceSetupGuidance({
            guidance,
            promptSwitchDefaultReleaseChannel: async () => await promptForSetupReleaseChannelSwitch({
                promptInputFn: input.promptInputFn,
                guidance,
            }),
            promptTakeOverManualRelayRuntime: async () => await promptForSetupManualRelayTakeover({
                promptInputFn: input.promptInputFn,
                guidance,
            }),
            promptReplaceExistingServices: async () => await promptForSetupServiceReplacement({
                promptInputFn: input.promptInputFn,
                guidance,
            }),
        });

        if (guidanceDecision.cancelled) {
            if (input.authenticatedHomeCreateContinuation) {
                throw Object.assign(new Error('Created Home service reconciliation was cancelled.'), {
                    code: 'home_create_reconciliation_failed',
                });
            }
            const out = createOutputBuilder();
            out.line('Aborted.');
            console.log(out.render());
            process.exitCode = 1;
            return { kind: 'cancelled' };
        }

        applyAcceptedBackgroundServiceGuidance = async () => {
            if (guidanceDecision.shouldSwitchDefaultReleaseChannel) {
                const targetReleaseChannelId: PublicReleaseRingId = resolvePublicReleaseRingIdForLabel(guidance.targetReleaseChannel);
                await input.writeDefaultManagedReleaseChannelFn({
                    processEnv: process.env,
                    releaseChannel: targetReleaseChannelId,
                });
                await input.syncInstalledFirstPartyShimsFn({
                    componentId: 'happier-cli',
                    channel: targetReleaseChannelId,
                    processEnv: process.env,
                });
            }
        };

        daemonSteps = resolveBackgroundServiceSetupReconciliationDisposition({
            guidance,
            targetChanged: input.relaySelectionChanged,
            tookOverManualRelayRuntime: guidanceDecision.shouldTakeOverManualRelayRuntime,
            replacedExistingServices: guidanceDecision.shouldReplaceExistingServices,
        }).map((action) => {
            if (action.kind === 'remove-existing') {
                return { argv: ['service', 'uninstall', '--all', '--yes'], display: 'happier service uninstall --all --yes' };
            }
            if (action.kind === 'restart') {
                return { argv: ['service', 'restart'], display: 'happier service restart' };
            }
            const takeoverArg = action.takeover ? ['--takeover'] : [];
            return {
                argv: ['service', action.kind, ...takeoverArg],
                display: `happier service ${action.kind}${action.takeover ? ' --takeover' : ''}`,
            };
        });
    }

    const runSetupStep = async (step: Readonly<{
        id?: string;
        argv: readonly string[];
        display: string;
    }>): Promise<SetupContinuationOutcome | null> => {
        const display = step.display;
        const exitCode = await input.runHappyCliStepFn(
            step.argv,
            input.signal ? { signal: input.signal } : undefined,
        );
        if (exitCode !== 0) {
            if (input.quiet || input.authenticatedHomeCreateContinuation) {
                throw Object.assign(new Error(`Setup step failed (exit ${exitCode}): ${display}`), {
                    code: 'home_create_reconciliation_failed',
                });
            }
            console.error(errorFrame('Error:', [`Setup step failed (exit ${exitCode}): ${display}`]));
            process.exitCode = exitCode;
            return { kind: 'failed', exitCode };
        }
        if (step.id === 'auth_login') {
            await input.onAuthCompleted?.();
        }
        return null;
    };

    for (const step of plan.steps) {
        if (step.id === 'daemon_install') {
            await applyAcceptedBackgroundServiceGuidance();
            for (const daemonStep of daemonSteps) {
                const outcome = await runSetupStep(daemonStep);
                if (outcome) return outcome;
            }
            continue;
        }
        if (step.id === 'daemon_start') continue;
        const outcome = await runSetupStep(step);
        if (outcome) return outcome;
    }

    const out = createOutputBuilder();
    out.line(ok('Setup complete.'));
    if (!input.quiet) console.log(out.render());
    if (!input.quiet) {
        await printSetupAgentReadiness(
            plan.steps.some((step) => step.id === 'agents_setup')
                ? input.listInstalledAgentIdsFn
                : async () => initialInstalledAgentIds,
        );
    }
    return { kind: 'continued' };
}

function ensurePersistWhenServerUrlIsProvided(args: readonly string[]): string[] {
    const hasServerUrl = args.some((a) => a === '--server-url' || String(a).startsWith('--server-url='));
    const hasPersistMode = args.includes('--persist') || args.includes('--no-persist');
    if (!hasServerUrl || hasPersistMode) return [...args];

    const currentServerUrl = normalizeRelayUrl(configuration.serverUrl);
    for (let index = 0; index < args.length; index += 1) {
        const current = String(args[index] ?? '');
        if (current === '--server-url') {
            const next = String(args[index + 1] ?? '');
            if (next && !next.startsWith('--') && normalizeRelayUrl(next) === currentServerUrl) {
                return [...args];
            }
        }
        if (current.startsWith('--server-url=')) {
            const next = current.slice('--server-url='.length);
            if (next && normalizeRelayUrl(next) === currentServerUrl) {
                return [...args];
            }
        }
    }
    const copied = [...args];
    for (let index = 0; index < copied.length; index += 1) {
        const current = String(copied[index] ?? '');
        if (current === '--server-url') {
            const insertAt = Math.min(index + 2, copied.length);
            copied.splice(insertAt, 0, '--persist');
            return copied;
        }
        if (current.startsWith('--server-url=')) {
            copied.splice(index + 1, 0, '--persist');
            return copied;
        }
    }
    return [...copied, '--persist'];
}

export async function handleSetupCommand(
    args: string[],
    deps: SetupCommandDeps = {},
    signal?: AbortSignal,
): Promise<void> {
    signal?.throwIfAborted();
    const readCredentialsFn = deps.readCredentialsFn ?? readStoredCredentials;
    const readSettingsFn = deps.readSettingsFn ?? readSettings;
    const isInteractiveTerminalFn = deps.isInteractiveTerminalFn ?? isInteractiveTerminal;
    const promptInputFn = deps.promptInputFn ?? promptInput;
    const quiet = deps.quiet === true;
    const authenticatedHomeCreateContinuation = deps.invocation === 'authenticated-home-create-continuation';
    const runHappyCliStepFn = deps.runHappyCliStepFn ?? (quiet ? runHappyCliStepQuiet : runHappyCliStep);
    const applyServerSelectionFromArgsFn = deps.applyServerSelectionFromArgs ?? applyServerSelectionFromArgs;
    const prepareServerSelectionFromArgsFn = deps.prepareServerSelectionFromArgsFn
        ?? (deps.applyServerSelectionFromArgs
            ? async (selectionArgs: string[]) => ({
                rest: await applyServerSelectionFromArgsFn(selectionArgs),
                profileId: null,
            })
            : prepareServerSelectionFromArgs);
    const applyResolvedServerSelectionNonFocusingFn = deps.applyResolvedServerSelectionNonFocusingFn
        ?? applyResolvedServerSelectionNonFocusing;
    const resolveServerSelectionFromArgsFn = deps.resolveServerSelectionFromArgs ?? resolveServerSelectionFromArgs;
    const readBackgroundServiceSetupGuidanceFn = deps.readBackgroundServiceSetupGuidanceFn ?? readBackgroundServiceSetupGuidance;
    const writeDefaultManagedReleaseChannelFn = deps.writeDefaultManagedReleaseChannelFn ?? writeDefaultManagedReleaseChannel;
    const syncInstalledFirstPartyShimsFn = deps.syncInstalledFirstPartyShimsFn ?? syncInstalledFirstPartyShims;
    const listInstalledAgentIdsFn = deps.listInstalledAgentIdsFn ?? listInstalledAgentIds;
    const runAccountServiceHomeEntryFn = deps.runAccountServiceHomeEntryFn ?? runCliAccountServiceSetupEntry;
    const parseHomeTargetArgsFn = deps.parseHomeTargetArgsFn ?? parseCliHomeTargetArgs;
    const resolveHomeTargetFn = deps.resolveHomeTargetFn ?? resolveCliHomeTarget;
    const resolveCurrentHomeTargetFn = deps.resolveCurrentHomeTargetFn ?? resolveCurrentCliHomeTarget;
    const adoptHomeDescriptorFn = deps.adoptHomeDescriptorFn ?? adoptServerProfileHomeConnectionDescriptor;
    const useHomeProfileFn = deps.useHomeProfileFn ?? useServerProfile;

    const json = wantsJson(args);
    const wantsHelp = args.includes('--help') || args.includes('-h') || args.includes('help');
    if (wantsHelp) {
        console.log(renderHelpPage(buildSetupHelpPage()));
        return;
    }

    const planMode = String(args[0] ?? '').trim() === 'plan';
    const kind = planMode ? 'setup_plan' : 'setup';
    const argsForRun = planMode ? args.slice(1) : args;
    const assumeYesFlag = argsForRun.includes('--yes');
    const nonInteractiveEnv = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.HAPPIER_NONINTERACTIVE ?? '').trim().toLowerCase(),
    );
    const forcedNonInteractive = argsForRun.includes('--non-interactive') || nonInteractiveEnv || (json && !planMode && !assumeYesFlag);

    // A create-nothing invocation must not open a descriptor file or block on
    // descriptor stdin merely to report that setup requires interaction.
    if (!planMode && forcedNonInteractive) {
        const out = createOutputBuilder();
        out.line(neutral('Non-interactive setup changes nothing. Run `happier setup` in a terminal, or name a Home and pass `--yes`.'));
        if (json) {
            await printJsonEnvelope({ ok: false, kind, error: { code: 'interactive_required', state: 'incomplete', mutated: false } });
        } else {
            console.log(out.render());
        }
        process.exitCode = 1;
        return;
    }

    if (!planMode && !assumeYesFlag && !isInteractiveTerminalFn()) {
        const out = createOutputBuilder();
        out.line(neutral('Setup needs an interactive terminal and changed nothing. Re-run `happier setup`, or name a Home and pass `--yes` for deterministic target setup only.'));
        console.log(out.render());
        process.exitCode = 1;
        return;
    }

    let parsedHomeTargetArgs = await parseHomeTargetArgsFn(
        argsForRun,
        deps.readHomeDescriptorTextFn
            ? { readDescriptorText: async (source) => await deps.readHomeDescriptorTextFn!(source) }
            : undefined,
    );
    const currentRelayUrl = normalizeRelayUrl(configuration.serverUrl);

    // Settled before anything else mutates state, because credentials are stored
    // per relay profile: signing in first and pointing at a self-hosted relay
    // afterwards leaves two accounts rather than a moved one.
    const relayNamedOnCommandLine = parsedHomeTargetArgs.target !== null;
    let useDefaultAccountService = false;
    let createPersonalHome = false;

    // `--yes` authorizes deterministic work, but it cannot choose the relay: a
    // wrong guess creates an account on the wrong server and cannot be migrated
    // by switching profiles afterwards.
    if (!planMode && assumeYesFlag && !relayNamedOnCommandLine) {
        const out = createOutputBuilder();
        out.line(warn('Setup needs you to choose a Home before it can continue.'));
        out.line(`Run ${cmd('happier setup')} in a terminal, or name the Home explicitly and pass ${cmd('--yes')}.`);
        if (json) {
            await printJsonEnvelope({ ok: false, kind, error: { code: 'target_required', state: 'incomplete', mutated: false } });
        } else {
            console.log(out.render());
        }
        process.exitCode = 1;
        return;
    }

    let readiness = !planMode && !relayNamedOnCommandLine
        ? await resolveActiveServerAuthReadiness({
            readCredentialsFn,
            readSettingsFn,
            ...(signal ? { signal } : {}),
        })
        : null;
    let initialDecision = readiness
        ? decideSetupReadiness({
            credentialState: readiness.credentialState,
            machineRegistrationState: readiness.machineRegistrationState,
            hasExplicitTarget: false,
        })
        : null;
    let setupWelcomeRendered = false;
    if (!planMode && !assumeYesFlag && !quiet && !json && initialDecision?.kind !== 'select-home') {
        console.log(renderSetupWelcome({
            machineName: hostname(),
            subtitle: 'Choose or create a Home. Your coding agents run here.',
        }));
        setupWelcomeRendered = true;
    }

    if (!planMode && initialDecision?.kind === 'home-unavailable') {
        const out = createOutputBuilder();
        out.line(warn(`Home at ${currentRelayUrl} did not answer.`));
        out.line(neutral('Stored sign-in was kept.'));
        console.log(out.render());
        const unavailablePrompt = createSetupSubmenuPrompt({
            question: 'What would you like to do?',
            choices: [
                { id: 'retry', key: 'r', label: 'Retry' },
                { id: 'choose', key: 'c', label: 'Choose another Home' },
                { id: 'exit', key: 'x', label: 'Exit and try later', isDefault: true },
            ],
        });
        const choice = await promptMultipleChoice(
            unavailablePrompt.message,
            [
                { id: 'retry', keys: ['r', 'retry'], short: 'r' },
                { id: 'choose', keys: ['c', 'choose'], short: 'c' },
                { id: 'exit', keys: ['x', 'exit'], short: 'x' },
            ] as const,
            {
                defaultId: 'exit',
                maxAttempts: 3,
                promptInputFn,
                ...(unavailablePrompt.renderMessage
                    ? { animate: unavailablePrompt.animate === true, renderMessage: unavailablePrompt.renderMessage }
                    : {}),
            },
        );
        if (choice === 'retry') {
            readiness = await resolveActiveServerAuthReadiness({
                readCredentialsFn,
                readSettingsFn,
                ...(signal ? { signal } : {}),
            });
            initialDecision = decideSetupReadiness({
                credentialState: readiness.credentialState,
                machineRegistrationState: readiness.machineRegistrationState,
                hasExplicitTarget: false,
            });
            if (initialDecision.kind === 'home-unavailable') {
                const retryOut = createOutputBuilder();
                retryOut.line(warn(`Home at ${currentRelayUrl} still did not answer.`));
                retryOut.line(neutral('Stored sign-in was kept. Run `happier setup` to retry later.'));
                console.log(retryOut.render());
                process.exitCode = 1;
                return;
            }
        } else if (choice === 'exit') {
            process.exitCode = 1;
            return;
        } else {
            initialDecision = { kind: 'select-home' };
        }
    }

    if (!planMode && !relayNamedOnCommandLine && !assumeYesFlag) {
        if (initialDecision?.kind === 'select-home') {
            const firstChoice = {
                question: 'How would you like to set up this computer?',
                description: 'A Home keeps your Happier account, sessions, and settings together.',
                choices: [
                    { id: 'find', key: 'f', label: 'Find my linked Homes (recommended)', description: 'Sign in through your sign-in service', isDefault: true },
                    { id: 'existing', key: 'e', label: 'Connect to an existing Home' },
                    { id: 'create', key: 'c', label: 'Create a Personal Home on this computer' },
                    { id: 'exit', key: 'x', label: 'Exit' },
                ],
            } as const;
            const setupChoicePrompt = setupWelcomeRendered
                ? createSetupSubmenuPrompt(firstChoice)
                : createSetupChoicePrompt({
                    machineName: hostname(),
                    subtitle: 'Choose or create a Home. Your coding agents run here.',
                    ...firstChoice,
                });
            const choice = await promptMultipleChoice(
                setupChoicePrompt.message,
                [
                    { id: 'find', keys: ['f', 'find', ''], short: 'f' },
                    { id: 'existing', keys: ['e', 'existing'], short: 'e' },
                    { id: 'create', keys: ['c', 'create'], short: 'c' },
                    { id: 'exit', keys: ['x', 'exit'], short: 'x' },
                ] as const,
                {
                    defaultId: 'find',
                    maxAttempts: 3,
                    promptInputFn,
                    ...('renderMessage' in setupChoicePrompt && setupChoicePrompt.renderMessage
                        ? { animate: setupChoicePrompt.animate === true, renderMessage: setupChoicePrompt.renderMessage }
                        : {}),
                },
            );
            if (choice === 'exit') {
                process.exitCode = 1;
                return;
            }
            if (choice === 'find') {
                useDefaultAccountService = true;
            } else if (choice === 'create') {
                createPersonalHome = true;
            } else {
                const targetArgs = await promptForExistingHomeTargetArgs(promptInputFn);
                if (!targetArgs) {
                    process.exitCode = 1;
                    return;
                }
                parsedHomeTargetArgs = await parseHomeTargetArgsFn(
                    [...targetArgs, ...parsedHomeTargetArgs.rest],
                    deps.readHomeDescriptorTextFn
                        ? { readDescriptorText: async (source) => await deps.readHomeDescriptorTextFn!(source) }
                        : undefined,
                );
            }
        }
    }

    // Confirmation is deliberately before relay installation or profile writes.
    // Choosing an answer previews intent; it is not itself consent to mutate.
    if (!planMode && !assumeYesFlag && !createPersonalHome) {
        if (!isInteractiveTerminalFn()) {
            throw new Error('Non-interactive mode: pass --yes with an explicit Home to run deterministic target setup only.');
        }
        const confirmationPrompt = useDefaultAccountService
            ? 'Sign in through your sign-in service (which may link or create its Account), find linked Homes, and continue now? [Y/n] '
            : parsedHomeTargetArgs.target
                ? 'Connect this computer to the selected Home now? [Y/n] '
                : 'Finish setting up this computer now? [Y/n] ';
        const confirm = (await promptInputFn(confirmationPrompt)).trim().toLowerCase();
        if (confirm.startsWith('n')) {
            const out = createOutputBuilder();
            out.line('Aborted.');
            console.log(out.render());
            process.exitCode = 1;
            return;
        }
    }

    if (createPersonalHome) {
        const exitCode = await runHappyCliStepFn(['home', 'create'], signal ? { signal } : undefined);
        if (exitCode !== 0) process.exitCode = exitCode;
        return;
    }

    let accountServiceContinuationCompleted = false;
    let accountServiceHomeAuthRecoveryRequired = false;
    const targetedAccountServiceContext = !useDefaultAccountService
        && (parsedHomeTargetArgs.target?.kind === 'descriptor'
            || parsedHomeTargetArgs.target?.kind === 'https_url')
        ? { kind: 'explicit' as const, target: parsedHomeTargetArgs.target }
        : !useDefaultAccountService && parsedHomeTargetArgs.target?.kind === 'saved_profile'
          ? { kind: 'selected' as const, target: parsedHomeTargetArgs.target }
          : null;
    if (!planMode && !assumeYesFlag && (useDefaultAccountService || targetedAccountServiceContext)) {
        const accountServiceExecution = parseSetupExecutionOptions(
            parsedHomeTargetArgs.rest.filter((argument) => argument !== '--persist' && argument !== '--no-persist'),
        );
        let result = await runAccountServiceHomeEntryFn({
            context: targetedAccountServiceContext ?? { kind: 'none' },
            builtInNoTargetDefault: { endpoint: DEFAULT_HAPPIER_CLOUD_SERVER_URL },
            ...(targetedAccountServiceContext
                ? {}
                : { intent: { kind: 'enter' as const, target: { kind: 'automatic' as const } } }),
            promptInputFn,
            ...(signal ? { signal } : {}),
            continueMachineAndService: async () => {
                // `runCliAccountServiceHomeEntry` deliberately crosses a
                // non-cancellable boundary after it focuses the enrolled Home.
                // Reload that canonical selection, then reuse the one setup
                // continuation owner without threading the pre-focus signal.
                reloadConfiguration();
                const selectedServerUrl = normalizeRelayUrl(configuration.serverUrl);
                const continuation = await continueSetupForSelectedHome({
                    serverUrl: selectedServerUrl,
                    relaySelectionChanged: selectedServerUrl !== currentRelayUrl,
                    includeAuth: false,
                    forceWebAuthentication: false,
                    recoverAccountMaterial: false,
                    execution: accountServiceExecution,
                    quiet,
                    authenticatedHomeCreateContinuation,
                    isInteractiveTerminalFn,
                    promptInputFn,
                    runHappyCliStepFn,
                    readBackgroundServiceSetupGuidanceFn,
                    writeDefaultManagedReleaseChannelFn,
                    syncInstalledFirstPartyShimsFn,
                    listInstalledAgentIdsFn,
                });
                if (continuation.kind === 'continued') {
                    accountServiceContinuationCompleted = true;
                    return continuation;
                }
                return { kind: continuation.kind === 'cancelled' ? 'cancelled' : 'failed' };
            },
        });
        if (result.kind === 'home_entered' && result.directoryAdoptionFailures?.length) {
            const out = createOutputBuilder();
            const failedHomes = result.directoryAdoptionFailures.map(({ label }) => label).join(', ');
            out.line(warn(`Setup completed for the selected Home, but ${failedHomes} could not be added from the Account Service.`));
            console.log(out.render());
        }
        if (result.kind === 'failure'
            && result.stage === 'material'
            && result.homeCredentialCommitted
            && result.retry) {
            const retryPrompt = createSetupSubmenuPrompt({
                question: 'This Home is connected, but its encryption mode could not be checked.',
                choices: [
                    { id: 'retry', key: 'r', label: 'Retry the Home material check' },
                    { id: 'exit', key: 'x', label: 'Exit', isDefault: true },
                ],
            });
            const choice = await promptMultipleChoice(
                retryPrompt.message,
                [
                    { id: 'retry', keys: ['r', 'retry'], short: 'r' },
                    { id: 'exit', keys: ['x', 'exit'], short: 'x' },
                ] as const,
                {
                    defaultId: 'exit',
                    maxAttempts: 3,
                    promptInputFn,
                    ...(retryPrompt.renderMessage
                        ? { animate: retryPrompt.animate === true, renderMessage: retryPrompt.renderMessage }
                        : {}),
                },
            );
            if (choice === 'retry') result = await result.retry();
        }
        // A Directory/Account Service failure before a Home credential is
        // committed is recoverable setup state, not a terminal setup error.
        // Keep the retry bounded to the disposition supplied by the shared
        // owner, then retain the existing direct-Home chooser as the fallback.
        if (result.kind === 'failure'
            && !result.homeCredentialCommitted
            && targetedAccountServiceContext === null) {
            if (result.recovery === 'retry_stage' && result.retry) {
                const recoveryPrompt = createSetupSubmenuPrompt({
                    question: 'Sign-in service setup failed. Retry the failed step or choose a Home directly.',
                    choices: [
                        { id: 'retry', key: 'r', label: 'Retry the failed step' },
                        { id: 'choose', key: 'h', label: 'Choose a Home directly' },
                        { id: 'exit', key: 'x', label: 'Exit', isDefault: true },
                    ],
                });
                const choice = await promptMultipleChoice(
                    recoveryPrompt.message,
                    [
                        { id: 'retry', keys: ['r', 'retry'], short: 'r' },
                        { id: 'choose', keys: ['h', 'choose'], short: 'h' },
                        { id: 'exit', keys: ['x', 'exit'], short: 'x' },
                    ] as const,
                    {
                        defaultId: 'exit',
                        maxAttempts: 3,
                        promptInputFn,
                        ...(recoveryPrompt.renderMessage
                            ? { animate: recoveryPrompt.animate === true, renderMessage: recoveryPrompt.renderMessage }
                            : {}),
                    },
                );
                if (choice === 'exit') {
                    process.exitCode = 1;
                    return;
                }
                if (choice === 'retry') {
                    try {
                        result = await result.retry();
                    } catch {
                        // Keep the original typed failure so the existing
                        // direct-Home chooser remains available after an
                        // unsuccessful retry attempt.
                    }
                }
            }
        }
        if (result.kind === 'cancelled') {
            if (process.exitCode === undefined || process.exitCode === 0) {
                const out = createOutputBuilder();
                out.line('Aborted.');
                console.log(out.render());
                process.exitCode = 1;
            }
            return;
        }
        const targetedServiceFallback = targetedAccountServiceContext !== null
            && result.kind !== 'direct_home_selected'
            && result.kind !== 'home_entered'
            && result.kind !== 'home_material_required'
            && !(result.kind === 'failure' && result.homeCredentialCommitted);
        if (result.kind === 'direct_home_selected' || targetedServiceFallback) {
            useDefaultAccountService = false;
        } else if (result.kind === 'account_connected_no_homes'
            || result.kind === 'account_service_unavailable'
            || result.kind === 'home_unavailable'
            || (result.kind === 'failure' && !result.homeCredentialCommitted)) {
            const recoveryPrompt = createSetupSubmenuPrompt({
                question: result.kind === 'account_connected_no_homes'
                    ? 'No linked Homes were found.'
                    : result.kind === 'failure'
                        ? 'Sign-in service setup did not complete. You can still connect directly to a Home.'
                        : 'Your sign-in service is unavailable. You can still connect directly to a Home.',
                choices: [
                    { id: 'create', key: 'c', label: 'Create a Personal Home on this computer' },
                    { id: 'connect', key: 'h', label: 'Connect to an existing Home' },
                    { id: 'exit', key: 'x', label: 'Exit', isDefault: true },
                ],
            });
            const choice = await promptMultipleChoice(
                recoveryPrompt.message,
                [
                    { id: 'create', keys: ['c', 'create'], short: 'c' },
                    { id: 'connect', keys: ['h', 'connect'], short: 'h' },
                    { id: 'exit', keys: ['x', 'exit'], short: 'x' },
                ] as const,
                {
                    defaultId: 'exit',
                    maxAttempts: 3,
                    promptInputFn,
                    ...(recoveryPrompt.renderMessage
                        ? { animate: recoveryPrompt.animate === true, renderMessage: recoveryPrompt.renderMessage }
                        : {}),
                },
            );
            if (choice === 'create') {
                const exitCode = await runHappyCliStepFn(['home', 'create'], signal ? { signal } : undefined);
                if (exitCode !== 0) process.exitCode = exitCode;
                return;
            }
            if (choice === 'connect') {
                const targetArgs = await promptForExistingHomeTargetArgs(promptInputFn);
                if (!targetArgs) {
                    process.exitCode = 1;
                    return;
                }
                parsedHomeTargetArgs = await parseHomeTargetArgsFn(
                    [...targetArgs, ...parsedHomeTargetArgs.rest],
                    deps.readHomeDescriptorTextFn
                        ? { readDescriptorText: async (source) => await deps.readHomeDescriptorTextFn!(source) }
                        : undefined,
                );
                useDefaultAccountService = false;
            } else {
                process.exitCode = 1;
                return;
            }
        } else if (result.kind === 'home_material_required') {
            parsedHomeTargetArgs = {
                target: { kind: 'saved_profile', profileRef: result.profileId },
                source: '--home',
                rest: parsedHomeTargetArgs.rest,
            };
            useDefaultAccountService = false;
            accountServiceHomeAuthRecoveryRequired = true;
        } else if (result.kind !== 'home_entered') {
            if (process.exitCode === undefined || process.exitCode === 0) {
                const out = createOutputBuilder();
                out.line(warn(result.kind === 'awaiting_approval'
                    ? 'Home approval is still required.'
                    : result.kind === 'explicit_target_not_linked'
                        ? 'That Home is not linked to this account. Connect to that exact Home directly.'
                        : result.kind === 'failure' && result.homeCredentialCommitted
                          ? 'This Home is connected. Machine registration can be retried with `happier setup`.'
                          : 'Setup could not enter a Home.'));
                console.log(out.render());
                process.exitCode = 1;
            }
            return;
        } else {
            if (accountServiceContinuationCompleted) return;
            const out = createOutputBuilder();
            out.line(warn('Setup entered the Home without completing machine and service setup. Run `happier setup` to retry.'));
            console.log(out.render());
            process.exitCode = 1;
            return;
        }
    }

    const explicitHomeTarget = parsedHomeTargetArgs.target;
    const explicitRelayUrl = explicitHomeTarget?.kind === 'https_url' ? explicitHomeTarget.url : null;
    const explicitDescriptor = explicitHomeTarget?.kind === 'descriptor' ? explicitHomeTarget.descriptor : null;
    const explicitRelayUrlMatchesCurrent = explicitRelayUrl != null && normalizeRelayUrl(explicitRelayUrl) === currentRelayUrl;
    const hasRelaySelectionOverrides = explicitHomeTarget?.kind === 'saved_profile'
        || (explicitHomeTarget?.kind === 'https_url'
            && (explicitHomeTarget.localUrl !== undefined || explicitHomeTarget.webappUrl !== undefined));
    const hasSelectedHomeTarget = explicitHomeTarget !== null;

    let argsAfterServerSelection = parsedHomeTargetArgs.rest.filter(
        (argument) => argument !== '--persist' && argument !== '--no-persist',
    );
    // `setup plan` is a dry run, so it resolves the selection instead of applying it:
    // planning must never switch the active relay, persist a profile, or rewrite env.
    let plannedRelayUrl: string | null = null;
    let plannedHomeTarget: Awaited<ReturnType<typeof resolveCliHomeTarget>> | null = null;
    let pendingHomeProfileId: string | null = null;
    if (explicitDescriptor) {
        const descriptor = explicitDescriptor;
        const resolved = await resolveHomeTargetFn({
            kind: 'descriptor',
            descriptor,
            authority: 'trusted_enrollment',
        });
        if (planMode) {
            plannedRelayUrl = resolved.canonicalAuthUrl;
            plannedHomeTarget = resolved;
        } else {
            const adopted = await adoptHomeDescriptorFn({
                descriptor,
                suggestedName: descriptor.homeServerIdentityId,
                observation: 'exact',
                use: false,
            });
            await applyResolvedServerSelectionNonFocusingFn({
                homeTarget: resolved,
                serverUrl: resolved.canonicalAuthUrl,
                localServerUrl: null,
                webappUrl: resolved.webappUrl,
                activeServerId: adopted.profile.id,
                application: { kind: 'ephemeralEnv' },
            });
            pendingHomeProfileId = adopted.profile.id;
            plannedRelayUrl = resolved.canonicalAuthUrl;
            plannedHomeTarget = resolved;
        }
    } else if (
        (explicitRelayUrl != null && !explicitRelayUrlMatchesCurrent)
        || hasRelaySelectionOverrides
    ) {
        const serverSelectionArgs = ensurePersistWhenServerUrlIsProvided(
            [
                ...projectCliHomeTargetToServerSelectionArgs(explicitHomeTarget!),
                ...parsedHomeTargetArgs.rest,
            ],
        );
        if (planMode) {
            const resolution = await resolveServerSelectionFromArgsFn(serverSelectionArgs);
            argsAfterServerSelection = [...resolution.rest];
            plannedRelayUrl = resolution.selection?.serverUrl ?? null;
            plannedHomeTarget = resolution.selection?.homeTarget ?? null;
        } else {
            const prepared = await prepareServerSelectionFromArgsFn(serverSelectionArgs);
            argsAfterServerSelection = [...prepared.rest];
            pendingHomeProfileId = prepared.profileId;
        }
    }

    let relayUrl = normalizeRelayUrl(explicitRelayUrl ?? plannedRelayUrl ?? configuration.serverUrl);
    let relaySelectionChanged = relayUrl !== currentRelayUrl;

    const execution = parseSetupExecutionOptions(argsAfterServerSelection);
    const {
        skipDaemon,
        skipProviders,
        providers,
        yes: yesFlag,
    } = execution;

    // Public --yes can authorize only deterministic target adoption. Even when
    // the named Home already has credentials, service/provider continuation is
    // a separate interactive setup outcome. Home creation enters through an
    // explicit trusted composition context after its atomic bootstrap has
    // committed authenticated credentials; quiet controls presentation only.
    if (yesFlag && !authenticatedHomeCreateContinuation) {
        const continuation = argsForRun.filter((argument) => argument !== '--yes' && argument !== '--json').join(' ');
        if (json) {
            await printJsonEnvelope({
                ok: false,
                kind,
                error: {
                    code: 'interactive_approval_required',
                    state: 'incomplete',
                    targetApplied: true,
                    continuation: `happier setup ${continuation}`.trim(),
                },
            });
        } else {
            const out = createOutputBuilder();
            out.line(warn('Home target saved. Interactive setup is still required.'));
            out.line(`  ${cmd(`happier setup ${continuation}`.trim())}`);
            console.log(out.render());
        }
        process.exitCode = 1;
        return;
    }

    readiness = readiness && !relaySelectionChanged
        ? readiness
        : await resolveActiveServerAuthReadiness({
            readCredentialsFn,
            readSettingsFn,
            ...(signal ? { signal } : {}),
        });
    if (readiness === null) throw new Error('Setup readiness was not resolved for the selected Home.');
    const readinessDecision = decideSetupReadiness({
        credentialState: readiness.credentialState,
        machineRegistrationState: readiness.machineRegistrationState,
        hasExplicitTarget: hasSelectedHomeTarget,
    });
    if (readinessDecision.kind === 'home-unavailable') {
        if (authenticatedHomeCreateContinuation) {
            throw Object.assign(new Error(`Created Home at ${relayUrl} did not answer during service reconciliation.`), {
                code: 'home_create_reconciliation_failed',
            });
        }
        const unavailable = createOutputBuilder();
        unavailable.line(warn(`Home at ${relayUrl} did not answer.`));
        unavailable.line(neutral('Stored sign-in was kept. Run `happier setup` to retry or choose another Home.'));
        console.log(unavailable.render());
        process.exitCode = 1;
        return;
    }
    const includeAuth = accountServiceHomeAuthRecoveryRequired
        || readinessDecision.kind === 'authenticate'
        || readinessDecision.kind === 'select-home';
    const selectedHomeTarget = plannedHomeTarget
        ?? await resolveCurrentHomeTargetFn().catch(() => null);

    const initialInstalledAgentIds = await listInstalledAgentIdsFn().catch(() => []);
    const plan = buildSetupPlan({
        serverUrl: relayUrl,
        includeAuth,
        // Descriptor-aware auth owns carrier acquisition and can offer mobile
        // approval even when the canonical URL is loopback. Only the legacy
        // URL-only path needs setup to constrain the method to same-machine web.
        forceWebAuthentication: selectedHomeTarget?.descriptor == null && isLoopbackServerHost(relayUrl),
        includeDaemon: !skipDaemon,
        skipProviders,
        installedAgentIds: initialInstalledAgentIds,
        providers,
        assumeYes: yesFlag,
        recoverAccountMaterial: accountServiceHomeAuthRecoveryRequired,
    });

    if (planMode) {
        if (json) {
            await printJsonEnvelope({
                ok: true,
                kind,
                data: {
                    relayUrl: plan.serverUrl,
                    steps: plan.steps.map((step) => ({
                        id: step.id,
                        command: step.display,
                        argv: step.argv,
                    })),
                },
            });
            return;
        }
        const out = createOutputBuilder();
        out.section('Setup plan', (section) => {
            section.definitionList([{ label: 'Home', value: plan.serverUrl }], { indent: '  ' });
            section.blank();
            section.numbered(plan.steps.map((step) => step.display));
        });
        console.log(out.render());
        return;
    }

    if (yesFlag && includeAuth && !authenticatedHomeCreateContinuation) {
        const out = createOutputBuilder();
        out.line(warn('Setup needs you for the last step — signing in has to be approved on a device.'));
        out.blank();
        out.line(`  ${cmd('happier auth login')}`);
        console.log(out.render());
        process.exitCode = 1;
        return;
    }

    let pendingHomeFocused = false;
    const focusPendingHome = async (): Promise<void> => {
        if (!pendingHomeProfileId || pendingHomeFocused) return;
        await useHomeProfileFn(pendingHomeProfileId);
        reloadConfiguration();
        pendingHomeFocused = true;
    };
    if (!includeAuth) {
        await focusPendingHome();
    }

    await continueSetupForSelectedHome({
        serverUrl: relayUrl,
        relaySelectionChanged,
        includeAuth,
        forceWebAuthentication: selectedHomeTarget?.descriptor == null && isLoopbackServerHost(relayUrl),
        recoverAccountMaterial: accountServiceHomeAuthRecoveryRequired,
        execution,
        quiet,
        authenticatedHomeCreateContinuation,
        isInteractiveTerminalFn,
        promptInputFn,
        runHappyCliStepFn,
        readBackgroundServiceSetupGuidanceFn,
        writeDefaultManagedReleaseChannelFn,
        syncInstalledFirstPartyShimsFn,
        listInstalledAgentIdsFn,
        initialInstalledAgentIds,
        onAuthCompleted: focusPendingHome,
        ...(signal ? { signal } : {}),
    });
}

export async function handleSetupCliCommand(context: CommandContext): Promise<void> {
    await handleSetupCommand(context.args.slice(1), {}, context.signal);
}

async function promptForSetupReleaseChannelSwitch(params: Readonly<{
    promptInputFn: typeof promptInput;
    guidance: BackgroundServiceSetupGuidance;
}>): Promise<boolean> {
    const answer = (await params.promptInputFn(
        `${formatBackgroundServiceReleaseChannelSwitchPrompt(params.guidance)} [Y/n] `,
    )).trim().toLowerCase();
    return !answer.startsWith('n');
}

async function promptForSetupServiceReplacement(params: Readonly<{
    promptInputFn: typeof promptInput;
    guidance: BackgroundServiceSetupGuidance;
}>): Promise<boolean> {
    const answer = (await params.promptInputFn(
        `${formatBackgroundServiceReplacementPrompt(params.guidance)} [Y/n] `,
    )).trim().toLowerCase();
    return !answer.startsWith('n');
}

async function promptForSetupManualRelayTakeover(params: Readonly<{
    promptInputFn: typeof promptInput;
    guidance: BackgroundServiceSetupGuidance;
}>): Promise<boolean> {
    const answer = (await params.promptInputFn(
        `${formatBackgroundServiceManualRelayTakeoverPrompt(params.guidance)} [Y/n] `,
    )).trim().toLowerCase();
    return !answer.startsWith('n');
}
