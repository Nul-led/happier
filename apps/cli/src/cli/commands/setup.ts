import { spawnHappyCLI } from '@/utils/spawnHappyCLI';

import type { CommandContext } from '@/cli/commandRegistry';
import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import {
    cmd,
    createOutputBuilder,
    errorFrame,
    neutral,
    ok,
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
import { AGENT_IDS, getAgentCliSetupRecommendedIds } from '@happier-dev/agents';
import { resolvePublicReleaseRingIdForLabel } from '@happier-dev/release-runtime/releaseRings';
import {
    buildSetupPlan,
    decideSetupReadiness,
} from './setupDecision';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';
import {
    applyBackgroundServiceSetupGuidance,
    readBackgroundServiceSetupGuidance,
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
        subtitle: 'Connect this computer to an existing Home',
        usage: [
            {
                label: cmd('happier setup [--home <saved>] [--home-url <https-url>] [--home-descriptor-file <path|->] [--provider <id> ...] [--skip-daemon] [--skip-providers] [--yes|--non-interactive]'),
                description: 'Connects this computer to an existing Home.',
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
            'With no usable active Home, uses the selected sign-in service (Happier Cloud by default) to find your linked Homes and opens the preferred Home.',
            'Pass --home, --home-url, or --home-descriptor-file to connect directly to a specific Home instead.',
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

function normalizeRelayUrl(raw: string): string {
    return raw.trim().replace(/\/+$/u, '');
}

async function runHappyCliStep(
    args: readonly string[],
    opts?: Readonly<{ env?: NodeJS.ProcessEnv }>,
): Promise<number> {
    const child = spawnHappyCLI([...args], {
        stdio: 'inherit',
        env: opts?.env,
        shell: false,
    });
    return await new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : 1));
        child.once('error', () => resolve(1));
    });
}

async function runHappyCliStepQuiet(args: readonly string[]): Promise<number> {
    const child = spawnHappyCLI([...args], { stdio: 'ignore', shell: false });
    return await new Promise<number>((resolve) => {
        child.once('exit', (code) => resolve(typeof code === 'number' ? code : 1));
        child.once('error', () => resolve(1));
    });
}

/**
 * The bundled agent CLIs that actually resolve on this computer.
 *
 * `AGENT_IDS` is the bundled agent list and, by construction, excludes the
 * `customAcp` compatibility family — that is a way of pointing Happier at an ACP
 * binary, not an installable CLI, so it could never answer "is an agent here".
 */
async function listInstalledAgentIds(): Promise<readonly string[]> {
    // Loaded on demand. Agent CLI resolution drags in the whole install/runtime
    // graph, and every setup path except this one final check gets there without it.
    const { resolveAgentCliCommand } = await import('@/packagedRuntime/managedTools/agentCliResolution');
    return AGENT_IDS.filter((agentId) => {
        try {
            return resolveAgentCliCommand(agentId, { processEnv: process.env }) !== null;
        } catch {
            // A resolver failure means "not usable here", which is what we asked.
            return false;
        }
    });
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
    console.log(out.render());
}

async function warnWhenNoCodingAgentIsInstalled(
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
    if (installedAgentIds.length > 0) return;
    printNoCodingAgentWarning();
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

export async function handleSetupCommand(args: string[], deps: SetupCommandDeps = {}): Promise<void> {
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

    const parsedHomeTargetArgs = await parseHomeTargetArgsFn(
        argsForRun,
        deps.readHomeDescriptorTextFn
            ? { readDescriptorText: async (source) => await deps.readHomeDescriptorTextFn!(source) }
            : undefined,
    );
    const explicitHomeTarget = parsedHomeTargetArgs.target;
    const explicitRelayUrl = explicitHomeTarget?.kind === 'https_url' ? explicitHomeTarget.url : null;
    const explicitDescriptor = explicitHomeTarget?.kind === 'descriptor' ? explicitHomeTarget.descriptor : null;
    const currentRelayUrl = normalizeRelayUrl(configuration.serverUrl);
    const explicitRelayUrlMatchesCurrent = explicitRelayUrl != null && normalizeRelayUrl(explicitRelayUrl) === currentRelayUrl;
    const hasRelaySelectionOverrides = explicitHomeTarget?.kind === 'saved_profile'
        || (explicitHomeTarget?.kind === 'https_url'
            && (explicitHomeTarget.localUrl !== undefined || explicitHomeTarget.webappUrl !== undefined));

    // Settled before anything else mutates state, because credentials are stored
    // per relay profile: signing in first and pointing at a self-hosted relay
    // afterwards leaves two accounts rather than a moved one.
    const relayNamedOnCommandLine = explicitHomeTarget !== null;
    let useDefaultAccountService = false;

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
        })
        : null;
    let initialDecision = readiness
        ? decideSetupReadiness({
            credentialState: readiness.credentialState,
            machineRegistrationState: readiness.machineRegistrationState,
            hasExplicitTarget: false,
        })
        : null;

    if (!planMode && !assumeYesFlag && !isInteractiveTerminalFn()) {
        const out = createOutputBuilder();
        out.line(neutral('Setup needs an interactive terminal and changed nothing. Re-run `happier setup`, or name a Home and pass `--yes` for deterministic target setup only.'));
        console.log(out.render());
        process.exitCode = 1;
        return;
    }

    if (!planMode && initialDecision?.kind === 'home-unavailable') {
        const out = createOutputBuilder();
        out.line(warn(`Home at ${currentRelayUrl} did not answer.`));
        out.line(neutral('Stored sign-in was kept.'));
        console.log(out.render());
        const choice = await promptMultipleChoice(
            ['Retry', 'Choose another Home', 'Exit and try later'].join('\n'),
            [
                { id: 'retry', keys: ['r', 'retry'], short: 'r' },
                { id: 'choose', keys: ['c', 'choose'], short: 'c' },
                { id: 'exit', keys: ['x', 'exit'], short: 'x' },
            ] as const,
            { defaultId: 'exit', maxAttempts: 3, promptInputFn },
        );
        if (choice === 'retry') {
            readiness = await resolveActiveServerAuthReadiness({ readCredentialsFn, readSettingsFn });
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
            useDefaultAccountService = true;
        }
    }

    // Confirmation is deliberately before relay installation or profile writes.
    // Choosing an answer previews intent; it is not itself consent to mutate.
    if (!planMode && !assumeYesFlag) {
        if (!isInteractiveTerminalFn()) {
            throw new Error('Non-interactive mode: pass --yes with an explicit Home to run deterministic target setup only.');
        }
        const confirm = (await promptInputFn('Run setup now? [Y/n] ')).trim().toLowerCase();
        if (confirm.startsWith('n')) {
            const out = createOutputBuilder();
            out.line('Aborted.');
            console.log(out.render());
            process.exitCode = 1;
            return;
        }
    }

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

    const { present: skipDaemon, rest: withoutSkipDaemon } = takeFlag(argsAfterServerSelection, '--skip-daemon');
    const { present: skipProviders, rest: withoutSkipProviders } = takeFlag(withoutSkipDaemon, '--skip-providers');
    const { values: providers, rest: remaining } = takeRepeatedFlagValues(withoutSkipProviders, '--provider');
    const { present: yesFlag, rest: withoutYes } = takeFlag(remaining, '--yes');
    const { rest: withoutJson } = takeFlag(withoutYes, '--json');
    const { rest: withoutNonInteractive } = takeFlag(withoutJson, '--non-interactive');
    if (withoutNonInteractive.length > 0) {
        throw new Error(`Unknown setup arguments: ${withoutNonInteractive.join(' ')}`);
    }

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

    let accountServiceEntryCompleted = false;
    if (useDefaultAccountService) {
        const result = await runAccountServiceHomeEntryFn({
            promptInputFn,
            timeoutMs: 300_000,
        });
        if (result.kind === 'no_linked_homes' || result.kind === 'no_preferred_home') {
            const choice = await promptMultipleChoice(
                [
                    result.kind === 'no_linked_homes' ? 'No linked Homes were found.' : 'No preferred Home is available.',
                    'Create a Personal Home on this computer',
                    'Connect using a saved Home or HTTPS address',
                    'Exit',
                ].join('\n'),
                [
                    { id: 'create', keys: ['c', 'create'], short: 'c' },
                    { id: 'connect', keys: ['h', 'connect'], short: 'h' },
                    { id: 'exit', keys: ['x', 'exit'], short: 'x' },
                ] as const,
                { defaultId: 'exit', maxAttempts: 3, promptInputFn },
            );
            if (choice === 'create') {
                const exitCode = await runHappyCliStepFn(['home', 'create']);
                if (exitCode !== 0) process.exitCode = exitCode;
                return;
            }
            if (choice === 'connect') {
                const target = (await promptInputFn('Saved Home name or HTTPS address: ')).trim();
                if (!target) {
                    process.exitCode = 1;
                    return;
                }
                const selectionArgs = /^https:\/\//iu.test(target)
                    ? ['--server-url', target, '--persist']
                    : ['--server', target];
                const prepared = await prepareServerSelectionFromArgsFn(selectionArgs);
                pendingHomeProfileId = prepared.profileId;
                relayUrl = normalizeRelayUrl(configuration.serverUrl);
                relaySelectionChanged = relayUrl !== currentRelayUrl;
            } else {
                process.exitCode = 1;
                return;
            }
        } else if (result.kind !== 'preferred_home_enrolled') {
            const out = createOutputBuilder();
            out.line(warn(result.kind === 'awaiting_approval'
                ? 'Home approval is still required.'
                : 'Setup could not enter a Home.'));
            console.log(out.render());
            process.exitCode = 1;
            return;
        } else {
            accountServiceEntryCompleted = true;
            reloadConfiguration();
            relayUrl = normalizeRelayUrl(configuration.serverUrl);
            relaySelectionChanged = relayUrl !== currentRelayUrl;
        }
    }

    if (!accountServiceEntryCompleted) {
        readiness = readiness && !relaySelectionChanged
            ? readiness
            : await resolveActiveServerAuthReadiness({ readCredentialsFn, readSettingsFn });
    }
    // A completed Account Service entry is already a strict authenticated
    // enrollment proof: its carrier verified identity/destination, committed
    // the Home credential, and registered this machine before release. A
    // second URL-only readiness probe here would reject an Iroh-only Home after
    // the bounded enrollment carrier has correctly closed.
    let readinessDecision: ReturnType<typeof decideSetupReadiness>;
    if (accountServiceEntryCompleted) {
        readinessDecision = { kind: 'ready' };
    } else {
        if (readiness === null) throw new Error('Setup readiness was not resolved for the selected Home.');
        readinessDecision = decideSetupReadiness({
            credentialState: readiness.credentialState,
            machineRegistrationState: readiness.machineRegistrationState,
            hasExplicitTarget: relayNamedOnCommandLine,
        });
    }
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
    const includeAuth = !accountServiceEntryCompleted
        && (readinessDecision.kind === 'authenticate' || readinessDecision.kind === 'select-home');
    const selectedHomeTarget = plannedHomeTarget
        ?? await resolveCurrentHomeTargetFn().catch(() => null);

    const plan = buildSetupPlan({
        serverUrl: relayUrl,
        includeAuth,
        // Descriptor-aware auth owns carrier acquisition and can offer mobile
        // approval even when the canonical URL is loopback. Only the legacy
        // URL-only path needs setup to constrain the method to same-machine web.
        forceWebAuthentication: selectedHomeTarget?.descriptor == null && isLoopbackServerHost(relayUrl),
        includeDaemon: !skipDaemon,
        includeProviders: !skipProviders,
        providers,
        assumeYes: yesFlag,
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

    const daemonSetupPreflightSteps: string[][] = [];
    let daemonStepOverrides: readonly Readonly<{ id: 'daemon_install' | 'daemon_start'; argv: readonly string[]; display: string }>[] =
      skipDaemon
        ? []
        : [
            {
                id: 'daemon_install',
                argv: ['service', 'install'],
                display: 'happier service install',
            },
            {
                id: 'daemon_start',
                argv: ['service', 'start'],
                display: 'happier service start',
            },
        ];
    if (!skipDaemon) {
        const guidance = await readBackgroundServiceSetupGuidanceFn({
            targetReleaseChannel: configuration.publicReleaseRing,
            targetServerUrl: relayUrl,
        });

        if (
            (
                guidance.shouldOfferDefaultReleaseChannelSwitch
                || guidance.shouldPromptForManualRelayTakeover
                || guidance.shouldPromptForServiceReplacement
            )
            && !isInteractiveTerminalFn()
        ) {
            throw new Error('Background service setup requires interactive guidance. Re-run in an interactive terminal or pass --skip-daemon.');
        }

        const guidanceResult = await applyBackgroundServiceSetupGuidance({
            guidance,
            promptSwitchDefaultReleaseChannel: async () => await promptForSetupReleaseChannelSwitch({
                promptInputFn,
                guidance,
            }),
            promptTakeOverManualRelayRuntime: async () => await promptForSetupManualRelayTakeover({
                promptInputFn,
                guidance,
            }),
            promptReplaceExistingServices: async () => await promptForSetupServiceReplacement({
                promptInputFn,
                guidance,
            }),
            switchDefaultReleaseChannel: async () => {
                const targetReleaseChannelId: PublicReleaseRingId = resolvePublicReleaseRingIdForLabel(guidance.targetReleaseChannel);
                await writeDefaultManagedReleaseChannelFn({
                    processEnv: process.env,
                    releaseChannel: targetReleaseChannelId,
                });
                await syncInstalledFirstPartyShimsFn({
                    componentId: 'happier-cli',
                    channel: targetReleaseChannelId,
                    processEnv: process.env,
                });
            },
            takeOverManualRelayRuntime: async () => undefined,
            replaceExistingServices: async () => {
                daemonSetupPreflightSteps.push(['service', 'uninstall', '--all', '--yes']);
            },
        });

        if (guidanceResult.cancelled) {
            if (authenticatedHomeCreateContinuation) {
                throw Object.assign(new Error('Created Home service reconciliation was cancelled.'), {
                    code: 'home_create_reconciliation_failed',
                });
            }
            const out = createOutputBuilder();
            out.line('Aborted.');
            console.log(out.render());
            process.exitCode = 1;
            return;
        }

        if (guidance.exactDefaultServiceExists && !guidanceResult.replacedExistingServices) {
            daemonStepOverrides = guidanceResult.tookOverManualRelayRuntime
                ? [{
                    id: 'daemon_start',
                    argv: ['service', 'start', '--takeover'],
                    display: 'happier service start --takeover',
                }]
                // The installed service resolved its relay once, when it
                // started — before this run switched the machine. Reusing it
                // untouched leaves the daemon on the previous relay while setup
                // reports success against the new one.
                : relaySelectionChanged
                    ? [{
                        id: 'daemon_start',
                        argv: ['service', 'restart'],
                        display: 'happier service restart',
                    }]
                    : [];
        } else {
            daemonStepOverrides = [
                {
                    id: 'daemon_install',
                    argv: ['service', 'install', ...(guidanceResult.tookOverManualRelayRuntime ? ['--takeover'] : [])],
                    display: `happier service install${guidanceResult.tookOverManualRelayRuntime ? ' --takeover' : ''}`,
                },
                {
                    id: 'daemon_start',
                    argv: ['service', 'start', ...(guidanceResult.tookOverManualRelayRuntime ? ['--takeover'] : [])],
                    display: `happier service start${guidanceResult.tookOverManualRelayRuntime ? ' --takeover' : ''}`,
                },
            ];
        }
    }

    const setupSteps = plan.steps.flatMap((step) => {
        if (step.id !== 'daemon_install' && step.id !== 'daemon_start') {
            return [step];
        }
        const override = daemonStepOverrides.find((entry) => entry.id === step.id);
        if (!override) {
            return [];
        }
        return [{
            ...step,
            argv: override.argv,
            display: override.display,
        }];
    });
    for (const step of [...daemonSetupPreflightSteps.map((argv) => ({ argv })), ...setupSteps]) {
        const display = 'display' in step ? step.display : `happier ${step.argv.join(' ')}`;
        const exitCode = await runHappyCliStepFn(step.argv);
        if (exitCode !== 0) {
            if (quiet || authenticatedHomeCreateContinuation) {
                throw Object.assign(new Error(`Setup step failed (exit ${exitCode}): ${display}`), {
                    code: 'home_create_reconciliation_failed',
                });
            }
            console.error(errorFrame('Error:', [`Setup step failed (exit ${exitCode}): ${display}`]));
            process.exitCode = exitCode;
            return;
        }
        if ('id' in step && step.id === 'auth_login') {
            await focusPendingHome();
        }
    }

    const out = createOutputBuilder();
    out.line(ok('Setup complete.'));
    if (!quiet) console.log(out.render());

    // Only when the user asked for no agent installs. Every other path just ran
    // `happier agents setup`, which fails loudly on a failed install and shows the
    // agent list when it asks — so a warning there would be either wrong or noise.
    if (skipProviders && !quiet) {
        await warnWhenNoCodingAgentIsInstalled(listInstalledAgentIdsFn);
    }
}

export async function handleSetupCliCommand(context: CommandContext): Promise<void> {
    await handleSetupCommand(context.args.slice(1));
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
