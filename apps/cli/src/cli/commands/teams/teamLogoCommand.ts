import {
  findCompiledActionCliCommand,
  listCompiledActionCliCommands,
  type CompiledActionCliCommand,
} from '@/cli/actions/compiledCommands';
import { buildActionCliHelpModel, renderActionCliHelpModel } from '@/cli/actions/commandHelp';
import { actionCliEnvelopeKind } from '@/cli/actions/commandPresentation';
import { type ActionCliExecutionDeps, runCompiledActionCliCommand } from '@/cli/actions/executeCommand';
import { ACTION_CLI_HELP_FLAGS, ACTION_CLI_JSON_OUTPUT_FLAG } from '@/cli/actions/parseCommandInput';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';

import { readTeamLogoSourceFromFile, type TeamLogoFileDeps } from './teamLogoFile';

const TEAM_LOGO_SET_PATH = ['teams', 'logo', 'set'] as const;
const IMAGE_FILE_FLAG = '--image-file';
const IMAGE_JSON_FLAG = '--image-json';

function requireTeamLogoSetCommand(): CompiledActionCliCommand {
    const command = findCompiledActionCliCommand(TEAM_LOGO_SET_PATH, listCompiledActionCliCommands());
    if (!command || command.path.join(' ') !== TEAM_LOGO_SET_PATH.join(' ')) {
        throw new Error(`Missing canonical Action command: ${TEAM_LOGO_SET_PATH.join(' ')}`);
    }
    return command;
}

/**
 * The compiled command's own help page with the adapter's one extra spelling
 * beside the canonical `--image-json` row. The compiler still owns every other
 * row, so a flag this command does not accept cannot appear here.
 */
function renderTeamLogoSetHelp(): string {
    const model = buildActionCliHelpModel(requireTeamLogoSetCommand());
    const options = [...model.options];
    const imageRow = options.findIndex((row) => row.label.includes(`${IMAGE_JSON_FLAG} <json>`));
    options.splice(imageRow >= 0 ? imageRow + 1 : options.length, 0, {
        label: `${IMAGE_FILE_FLAG} <path>`,
        description: 'Read the logo image from a local file instead of inline JSON',
    });
    return renderActionCliHelpModel({ ...model, options });
}

/**
 * `happier teams logo set --image-file <path>`.
 *
 * The compiled Action command owns the whole invocation — authorization,
 * targeting, validation, approval and output. This adapter owns exactly one
 * thing the terminal has and the app does not: a path. It turns that path into
 * the canonical `image` input and hands the unchanged command the argv it
 * already understands, so there is no second Team-logo writer, presenter or
 * flag grammar.
 */
export async function tryHandleTeamLogoFileCliCommand(params: Readonly<{
    argv: readonly string[];
    signal?: AbortSignal;
    deps?: Partial<TeamLogoFileDeps>;
    actionExecutionDeps?: Partial<ActionCliExecutionDeps>;
}>): Promise<boolean> {
    const { argv } = params;
    if (!TEAM_LOGO_SET_PATH.every((segment, index) => argv[index] === segment)) return false;

    const rest = argv.slice(TEAM_LOGO_SET_PATH.length);
    let filePath: string | null = null;
    let helpRequested = false;
    let jsonOutput = false;
    const forwarded: string[] = [];
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index] ?? '';
        if (token === '--') {
            forwarded.push(...rest.slice(index));
            break;
        }
        const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
        if ((ACTION_CLI_HELP_FLAGS as readonly string[]).includes(name)) helpRequested = true;
        if (name === ACTION_CLI_JSON_OUTPUT_FLAG) jsonOutput = true;
        if (name !== IMAGE_FILE_FLAG) {
            forwarded.push(token);
            continue;
        }
        let value: string | null;
        if (token.includes('=')) {
            value = token.slice(IMAGE_FILE_FLAG.length + 1) || null;
        } else {
            const next = rest[index + 1];
            value = typeof next === 'string' && !next.startsWith('--') ? next : null;
            if (value !== null) index += 1;
        }
        if (value === null) {
            throw Object.assign(new Error(`Option ${IMAGE_FILE_FLAG} requires a path.`), { code: 'invalid_arguments' });
        }
        if (filePath !== null) {
            throw Object.assign(new Error(`Provide ${IMAGE_FILE_FLAG} once.`), { code: 'invalid_arguments' });
        }
        filePath = value;
    }
    // Generic Action help cannot describe a CLI-local spelling, so this command
    // answers its own help request; everything on the page still comes from the
    // compiled command.
    if (helpRequested) {
        const help = renderTeamLogoSetHelp();
        if (jsonOutput) {
            await printJsonEnvelope({ ok: true, kind: actionCliEnvelopeKind(TEAM_LOGO_SET_PATH), data: { help } });
        } else {
            console.log(help);
        }
        return true;
    }
    // Without the file flag this is an ordinary compiled command; the dispatcher
    // runs it exactly as it always did.
    if (filePath === null) return false;
    if (forwarded.some((token) => token === IMAGE_JSON_FLAG || token.startsWith(`${IMAGE_JSON_FLAG}=`))) {
        throw Object.assign(
            new Error(`Provide the image either with ${IMAGE_FILE_FLAG} or with ${IMAGE_JSON_FLAG}, not both.`),
            { code: 'invalid_arguments' },
        );
    }

    const image = await readTeamLogoSourceFromFile(filePath, params.deps ?? {});
    await runCompiledActionCliCommand({
        command: requireTeamLogoSetCommand(),
        argv: [...TEAM_LOGO_SET_PATH, IMAGE_JSON_FLAG, JSON.stringify(image), ...forwarded],
        ...(params.signal ? { signal: params.signal } : {}),
        ...(params.actionExecutionDeps ? { deps: params.actionExecutionDeps } : {}),
    });
    return true;
}
