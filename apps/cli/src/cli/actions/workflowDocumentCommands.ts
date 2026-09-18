import { readFile, writeFile } from 'node:fs/promises';

import {
  WorkflowActionOutputSchemasV1,
  WorkflowDocumentParseErrorV1,
  WorkflowDocumentV1Schema,
  parseWorkflowDocumentJsonV1,
  serializeWorkflowDocumentJsonV1,
  validateWorkflowDefinition,
} from '@happier-dev/protocol';

import { printJsonEnvelope, writeJsonStdout } from '@/cli/output/jsonEnvelope';
import { argvBeforeOptionTerminator } from '@/cli/commands/shared/argvFlags';
import { resolveAbsolutePathFromWorkingDirectory } from '@/utils/path/expandHomeDirPath';

import { findCompiledActionCliCommand, listCompiledActionCliCommands } from './compiledCommands';
import { type ActionCliExecutionDeps, runCompiledActionCliCommand } from './executeCommand';

type WorkflowDocumentCommandDeps = Readonly<{
  readFileFn: (path: string) => Promise<string | Uint8Array>;
  readStdinFn: () => Promise<string | Uint8Array>;
  writeFileFn: (path: string, content: string) => Promise<void>;
  actionExecutionDeps?: Partial<ActionCliExecutionDeps>;
}>;

const DEFAULT_DEPS: WorkflowDocumentCommandDeps = {
  readFileFn: readFile,
  readStdinFn: async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
  },
  writeFileFn: async (path, content) => writeFile(path, content, 'utf8'),
};

function decodeUtf8(content: string | Uint8Array): string {
  if (typeof content === 'string') return content;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch (error) {
    throw Object.assign(new TypeError('Workflow document is not valid UTF-8', { cause: error }), {
      code: 'invalid_workflow_document_encoding',
    });
  }
}

function commandFor(path: readonly string[]) {
  const command = findCompiledActionCliCommand(path, listCompiledActionCliCommands());
  if (!command || command.path.join(' ') !== path.join(' ')) {
    throw new Error(`Missing canonical Action command: ${path.join(' ')}`);
  }
  return command;
}

function valueOption(argv: readonly string[], name: string): string | null {
  let selected: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    let value: string | null = null;
    if (token === name) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new TypeError(`${name} requires a value.`);
      value = next;
      index += 1;
    } else if (token.startsWith(`${name}=`)) {
      value = token.slice(name.length + 1);
      if (!value) throw new TypeError(`${name} requires a value.`);
    }
    if (value === null) continue;
    if (selected !== null) throw new TypeError(`Provide ${name} once.`);
    selected = value;
  }
  return selected;
}

function transportArgs(argv: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--json') {
      kept.push(token);
      continue;
    }
    if (token === '--server-id' || token === '--machine-id') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new TypeError(`${token} requires a value.`);
      kept.push(token, next);
      index += 1;
      continue;
    }
    if (token.startsWith('--server-id=') || token.startsWith('--machine-id=')) kept.push(token);
  }
  return kept;
}

function workflowDocumentVersion(raw: string): unknown {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { version?: unknown }).version
      : undefined;
  } catch {
    return undefined;
  }
}

async function reportError(
  argv: readonly string[],
  kind: string,
  code: string,
  fields: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  if (argvBeforeOptionTerminator(argv).includes('--json')) {
    await printJsonEnvelope({
      ok: false,
      kind,
      error: { code, ...fields },
    }, { exitCode: 1 });
    return;
  }
  console.error(`Error: ${code}`);
  process.exitCode = 1;
}

function assertKnownOptions(argv: readonly string[], valueOptions: ReadonlySet<string>): void {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const name = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (name === '--json') continue;
    if (!valueOptions.has(name)) throw new TypeError(`Unknown option: ${name}`);
    if (!token.includes('=')) index += 1;
  }
}

function positionalAt(argv: readonly string[], index: number): string | null {
  const value = argv[index];
  return value && !value.startsWith('--') ? value : null;
}

/**
 * Thin file boundary for the canonical workflow definition Actions. The file
 * wrapper is parsed/serialized by Protocol; auth, encryption, CAS and remote
 * execution remain in the ordinary compiled Action path.
 */
export async function tryHandleWorkflowDocumentCliCommand(params: Readonly<{
  argv: readonly string[];
  readFileFn?: WorkflowDocumentCommandDeps['readFileFn'];
  readStdinFn?: WorkflowDocumentCommandDeps['readStdinFn'];
  writeFileFn?: WorkflowDocumentCommandDeps['writeFileFn'];
  actionExecutionDeps?: Partial<ActionCliExecutionDeps>;
  signal?: AbortSignal;
}>): Promise<boolean> {
  const argv = argvBeforeOptionTerminator(params.argv);
  const operation = argv[0] === 'workflow' && argv[1] === 'definition'
    ? argv[2]
    : null;
  if (operation !== 'import' && operation !== 'export') return false;

  const deps = { ...DEFAULT_DEPS, ...params };
  const kind = `workflow_definition_${operation}`;
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      const usage = operation === 'import'
        ? 'Usage: happier workflow definition import <file|-> --definition-id <id> --metadata-json <json> [--server-id <id>] [--machine-id <id>] [--json]'
        : 'Usage: happier workflow definition export <definition-id> [file|-] [--server-id <id>] [--machine-id <id>]';
      console.log(usage);
      return true;
    }
    const transport = transportArgs(argv.slice(3));
    if (operation === 'import') {
      const source = positionalAt(argv, 3);
      assertKnownOptions(
        argv.slice(4),
        new Set(['--definition-id', '--metadata-json', '--server-id', '--machine-id']),
      );
      const definitionId = valueOption(argv.slice(4), '--definition-id');
      const metadataJson = valueOption(argv.slice(4), '--metadata-json');
      if (!source || !definitionId || !metadataJson) {
        throw new TypeError('Import requires <file|->, --definition-id, and --metadata-json.');
      }
      const raw = decodeUtf8(source === '-'
        ? await deps.readStdinFn()
        : await deps.readFileFn(resolveAbsolutePathFromWorkingDirectory(source) ?? source));
      const version = workflowDocumentVersion(raw);
      if (version !== undefined && version !== 1) {
        await reportError(params.argv, kind, 'unsupported_workflow_document_version', { version });
        return true;
      }
      let definitionInput: unknown;
      try {
        definitionInput = parseWorkflowDocumentJsonV1(raw).definition;
      } catch (error) {
        if (error instanceof WorkflowDocumentParseErrorV1) {
          if (error.code === 'workflow_document_invalid_json') throw error;
          if (error.code === 'workflow_document_unsupported_version') {
            await reportError(params.argv, kind, 'unsupported_workflow_document_version', { version });
            return true;
          }
        }
        const parsedJson = JSON.parse(raw) as unknown;
        const parsedDocument = WorkflowDocumentV1Schema.safeParse(parsedJson);
        if (
          !parsedDocument.success
          && parsedDocument.error.issues.every((issue) => issue.path[0] === 'definition')
          && parsedJson !== null
          && typeof parsedJson === 'object'
          && !Array.isArray(parsedJson)
        ) {
          definitionInput = (parsedJson as { definition?: unknown }).definition;
        } else {
          throw error;
        }
      }
      const validation = validateWorkflowDefinition(definitionInput);
      if (!validation.valid || validation.normalizedDefinition === undefined) {
        await reportError(params.argv, kind, 'invalid_workflow_definition', { issues: validation.issues });
        return true;
      }
      const metadata = JSON.parse(metadataJson) as unknown;
      const command = commandFor(['workflow', 'definition', 'create']);
      await runCompiledActionCliCommand({
        command,
        argv: [
          ...command.path,
          '--input-json',
          JSON.stringify({ definitionId, definition: validation.normalizedDefinition, metadata }),
          ...transport,
        ],
        ...(deps.actionExecutionDeps ? { deps: deps.actionExecutionDeps } : {}),
        ...(params.signal ? { signal: params.signal } : {}),
      });
      return true;
    }

    const definitionId = positionalAt(argv, 3);
    if (!definitionId) throw new TypeError('Export requires <definition-id>.');
    const target = positionalAt(argv, 4);
    assertKnownOptions(
      argv.slice(target ? 5 : 4),
      new Set(['--server-id', '--machine-id']),
    );
    const command = commandFor(['workflow', 'definition', 'get']);
    await runCompiledActionCliCommand({
      command,
      argv: [...command.path, '--input-json', JSON.stringify({ definitionId }), ...transport],
      ...(deps.actionExecutionDeps ? { deps: deps.actionExecutionDeps } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
      consumeSuccess: async (payload) => {
        const result = WorkflowActionOutputSchemasV1['workflow.definition.get'].parse(payload);
        const json = serializeWorkflowDocumentJsonV1({
          kind: 'happier.workflow',
          version: 1,
          definition: result.definition,
        });
        if (!target || target === '-') {
          await writeJsonStdout(JSON.parse(json) as unknown);
        } else {
          await deps.writeFileFn(resolveAbsolutePathFromWorkingDirectory(target) ?? target, `${json}\n`);
        }
        return true;
      },
    });
    return true;
  } catch (error) {
    await reportError(
      params.argv,
      kind,
      'invalid_workflow_document_command',
      error instanceof Error ? { message: error.message } : {},
    );
    return true;
  }
}
