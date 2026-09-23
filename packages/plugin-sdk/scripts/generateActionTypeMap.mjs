import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  resolveWorkspaceBundleLockPath,
  withWorkspaceBundleLock,
} from '../../../scripts/workspaces/workspaceBundleLock.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), '../../..');
const PACKAGE_ROOT = resolve(REPO_ROOT, 'packages/plugin-sdk');
const WORKSPACE_BUILD_LOCK_PATH = resolveWorkspaceBundleLockPath(REPO_ROOT);
const OUTPUT_PATH = resolve(REPO_ROOT, 'packages/plugin-sdk/src/actions/actionTypeMap.generated.ts');
const PROTOCOL_TSCONFIG_PATH = resolve(REPO_ROOT, 'packages/protocol/tsconfig.json');
const SDK_TSCONFIG_PATH = resolve(REPO_ROOT, 'packages/plugin-sdk/tsconfig.json');
const TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation
  | ts.TypeFormatFlags.UseStructuralFallback
  | ts.TypeFormatFlags.MultilineObjectLiterals
  | ts.TypeFormatFlags.InTypeAlias
  | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const RUNTIME_ACTION_SCHEMA = 'ZodType<unknown, unknown, $ZodTypeInternals<unknown, unknown>>';
const OPAQUE_VALIDATOR_BRANDED_STRING = /string & \$brand<'[^']+'>/gu;
const MUTABLE_PROTOCOL_JSON_VALUE = /\bPluginJsonValueV2\b/gu;
const FORBIDDEN_PUBLIC_VALIDATOR_REFERENCE = /(?:['"]zod(?:\/[^'"]*)?['"]|\bz\.[A-Za-z_$]|\bZod[A-Za-z0-9_]*\b|\$(?:brand|Zod[A-Za-z0-9_]*))/u;

export function createActionTypeMapTimingReporter({
  now = () => performance.now(),
  write = (line) => process.stderr.write(line),
} = {}) {
  const startedAt = now();
  let previousAt = startedAt;
  return (phase) => {
    const currentAt = now();
    write(
      `action-type-map: phase=${phase} deltaMs=${Math.round(currentAt - previousAt)} totalMs=${Math.round(currentAt - startedAt)}\n`,
    );
    previousAt = currentAt;
  };
}

/**
 * Recursive aliases which TypeScript intentionally keeps named while printing
 * the canonical Action maps. Generated SDK declarations must not depend on a
 * private Protocol path or a validator-library alias.
 */
const ACTION_TYPE_CLOSURE = [
  'export type PluginAgentExternalSessionLinkDataArray = readonly PluginAgentExternalSessionLinkDataValue[];',
  'export type PluginAgentExternalSessionLinkDataObject = { readonly [key: string]: PluginAgentExternalSessionLinkDataValue };',
  'export type PluginAgentExternalSessionLinkDataValue = null | boolean | number | string | PluginAgentExternalSessionLinkDataArray | PluginAgentExternalSessionLinkDataObject;',
  '',
  'export type JSONType = string | number | boolean | null | JSONType[] | { [key: string]: JSONType };',
];

/**
 * These are type-only projections of one canonical Protocol Action catalog.
 * Their order supplies the few named helper types intentionally retained by
 * TypeScript's structural printer; all Action ids and map rows are derived.
 */
const TYPE_PROJECTIONS = [
  // Action-map support types are projected under SDK-owned names. Recursive
  // workflow signatures must remain nameable by authors, while their source
  // definitions and validation continue to have one canonical Protocol owner.
  { relativePath: 'packages/protocol/src/plugins/contributions/publicTypes.ts', name: 'PluginPolicyExpressionV2', export: true, local: true },
  { relativePath: 'packages/protocol/src/actions/actionUiPlacements.ts', name: 'ActionUiPlacement', export: true },
  { relativePath: 'packages/protocol/src/sessions/work/state/sessionWorkStateRpc.ts', name: 'SessionUsageLimitCheckNowRequestV1Input', export: true },
  { relativePath: 'packages/protocol/src/sessions/work/state/sessionWorkStateRpc.ts', name: 'SessionUsageLimitConsumeResetCreditRequestV1Input', export: true },
  { relativePath: 'packages/protocol/src/actions/actionSpecs.ts', name: 'SessionTranscriptGetExternalShareableInputV1', export: true },
  { relativePath: 'packages/protocol/src/actions/actionSpecs.ts', name: 'SessionTranscriptGetExternalShareableResultV1', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'ActionInputFieldHint', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'ActionInputHints', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'ActionInputOption', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'ActionInputOptionValue', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'ActionInputPredicate', export: true },
  { relativePath: 'packages/protocol/src/actions/actionInputHintsRuntime.ts', name: 'EffectiveActionInputField', export: true },
  { relativePath: 'packages/protocol/src/actions/actionExecutionResult.ts', name: 'ActionApprovalRequestCreatedResult', export: true },
  { relativePath: 'packages/protocol/src/actions/actionExecutionResult.ts', name: 'ActionExecuteResult', export: true },
  { relativePath: 'packages/protocol/src/machines/administration/pluginMachineExecutionOriginV1.ts', name: 'PluginMachineExecutionOriginV1', export: true },
  { relativePath: 'packages/protocol/src/plugins/actions/v2.ts', name: 'PluginActionContributionV2', export: true },
  { relativePath: 'packages/protocol/src/plugins/actions/v2.ts', name: 'PluginToolContributionV2', export: true },
  { relativePath: 'packages/protocol/src/plugins/contributions/v2.ts', name: 'PluginCommandContributionV2', export: true },
  // Workflow Actions retain named authored aliases when TypeScript prints
  // their recursive structural map rows. Publish that closed declaration
  // graph as Action-map projections; every definition is still generated from
  // the canonical workflow owner rather than maintained as a second model.
  { relativePath: 'packages/protocol/src/workflows/workflowReferenceV1.ts', name: 'WorkflowAuthoredResultReference', outputName: 'PluginActionWorkflowAuthoredResultReferenceV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowReferenceV1.ts', name: 'WorkflowValueReference', outputName: 'PluginActionWorkflowValueReferenceV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowReferenceV1.ts', name: 'WorkflowCondition', outputName: 'PluginActionWorkflowConditionV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/sessions/metadata/runtimeDescriptorV1.ts', name: 'PortableRuntimeDescriptorV1', outputName: 'PluginActionWorkflowPortableRuntimeDescriptorV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowSessionAuthoringSelection', outputName: 'PluginActionWorkflowSessionAuthoringSelectionV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowStepExecutionSelection', outputName: 'PluginActionWorkflowStepExecutionSelectionV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowStep', outputName: 'PluginActionWorkflowStepV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowFailurePolicy', outputName: 'PluginActionWorkflowFailurePolicyV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowItemExecutionMode', outputName: 'PluginActionWorkflowItemExecutionModeV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowEvaluatorHistoryMode', outputName: 'PluginActionWorkflowEvaluatorHistoryModeV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowParallelBranch', outputName: 'PluginActionWorkflowParallelBranchV1', export: true, rewriteReferences: true },
  { relativePath: 'packages/protocol/src/workflows/workflowV1.ts', name: 'WorkflowRepetition', outputName: 'PluginActionWorkflowRepetitionV1', export: true, rewriteReferences: true },
  {
    relativePath: 'packages/protocol/src/workflows/workflowV1.ts',
    name: 'WorkflowBlock',
    outputName: 'PluginActionWorkflowBlockV1',
    export: true,
    rewriteReferences: true,
  },
  // Authored ingress blocks accept prompt-only shorthand at any block-list
  // position; executable blocks do not. Project the canonical ingress union
  // through the same rewrite path so Action inputs stay exact and recursive.
  {
    relativePath: 'packages/protocol/src/workflows/workflowV1.ts',
    name: 'WorkflowIngressBlock',
    outputName: 'PluginActionWorkflowIngressBlockV1',
    export: true,
    rewriteReferences: true,
  },
  {
    relativePath: 'packages/protocol/src/actions/actionSpecs.ts',
    name: 'PluginInvocableActionSpec',
    outputName: 'ActionSpec',
    export: true,
  },
  { relativePath: 'packages/protocol/src/actions/actionSpecs.ts', name: 'PluginActionInputById', export: true },
  { relativePath: 'packages/protocol/src/actions/actionSpecs.ts', name: 'PluginActionResultById', export: true },
];

export function resolveActionTypeProjectionRootNames({
  projections = TYPE_PROJECTIONS,
  repoRoot = REPO_ROOT,
} = {}) {
  return [...new Set(projections.map(({ relativePath }) => resolve(repoRoot, relativePath)))].sort();
}

const PRIVATE_OR_ABSOLUTE_IMPORT = /(?:@happier-dev\/|\bimport\s*\(|\bfrom\s*['"](?:\/|[A-Za-z]:[\\/]))/u;

function requireArgument() {
  const argument = process.argv.slice(2);
  if (argument.length !== 1 || (argument[0] !== '--check' && argument[0] !== '--write')) {
    throw new Error('Usage: node scripts/generateActionTypeMap.mjs --check|--write');
  }
  return argument[0];
}

function requireParsedConfig(path, label) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error(`Unable to read ${label} TypeScript configuration: ${path}`);
  return parsed;
}

function requireProtocolProgram() {
  const parsed = requireParsedConfig(PROTOCOL_TSCONFIG_PATH, 'Protocol');
  const program = ts.createProgram({
    // The projection needs only its declared Protocol owners and their normal
    // transitive imports. Rooting the compiler at every Protocol source file
    // makes an Action-map check pay for unrelated graphs and can push the
    // structural printer into pathological heap growth on busy workspaces.
    rootNames: resolveActionTypeProjectionRootNames(),
    options: parsed.options,
  });
  const diagnostics = program.getOptionsDiagnostics();
  if (diagnostics.length > 0) {
    throw new Error(`Cannot derive Action types with invalid Protocol compiler options: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`);
  }
  return Object.freeze({ checker: program.getTypeChecker(), program });
}

function sourceFileFor(program, relativePath) {
  const sourcePath = resolve(REPO_ROOT, relativePath);
  const sourceFile = program.getSourceFile(sourcePath);
  if (!sourceFile) throw new Error(`Protocol source is unavailable: ${relativePath}`);
  return sourceFile;
}

function projectedType(checker, sourceFile, { name, local }) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  const exported = moduleSymbol
    ? checker.getExportsOfModule(moduleSymbol).find((candidate) => candidate.name === name)
    : undefined;
  const symbol = exported ?? (local ? sourceFile.locals?.get(name) : undefined);
  if (!symbol) {
    const availability = local ? 'Protocol declaration' : 'Protocol export';
    throw new Error(`${availability} is unavailable: ${name} from ${sourceFile.fileName}`);
  }
  return checker.getDeclaredTypeOfSymbol(symbol);
}

function renderTypeAlias(name, typeText, exported) {
  if (PRIVATE_OR_ABSOLUTE_IMPORT.test(typeText)) {
    throw new Error(`${name} structural projection contains a private or absolute import.`);
  }
  const source = ts.createSourceFile(
    'actionTypeMap.generated.ts',
    `${exported ? 'export ' : ''}type ${name} = ${typeText};`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = source.parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(`${name} structural projection is not valid TypeScript: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`);
  }
  return canonicalizeGeneratedTypeOrder(source.text);
}

export function canonicalizeGeneratedTypeOrder(sourceText) {
  const source = ts.createSourceFile(
    'actionTypeMap.generated.ts',
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const transformed = ts.transform(source, [
    (context) => {
      const visit = (node) => {
        const visited = ts.visitEachChild(node, visit, context);
        if (!ts.isUnionTypeNode(visited) && !ts.isIntersectionTypeNode(visited)) {
          return visited;
        }
        const members = [...visited.types].sort((left, right) => {
          const leftText = printer.printNode(ts.EmitHint.Unspecified, left, source);
          const rightText = printer.printNode(ts.EmitHint.Unspecified, right, source);
          return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
        });
        return ts.isUnionTypeNode(visited)
          ? ts.factory.updateUnionTypeNode(visited, members)
          : ts.factory.updateIntersectionTypeNode(visited, members);
      };
      return (root) => ts.visitNode(root, visit);
    },
  ]);
  try {
    return printer.printFile(transformed.transformed[0]).trimEnd();
  } finally {
    transformed.dispose();
  }
}

/**
 * Action schemas and validator brands remain Protocol runtime implementation
 * facts. Public Action signatures expose schema slots opaquely and branded
 * result scalars as their ordinary string representation, without changing
 * the canonical Action catalog, caller policy, or invocation behavior.
 */
function renderPublicActionProjectionType(typeText) {
  return inlinePrivateProtocolObjectProjections(typeText)
    .replaceAll(RUNTIME_ACTION_SCHEMA, 'unknown')
    .replace(OPAQUE_VALIDATOR_BRANDED_STRING, 'string');
}

function typeReferenceName(node) {
  return ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
}

function withoutTopLevelUndefined(node) {
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) {
    return Object.freeze({ optional: true, type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword) });
  }
  if (!ts.isUnionTypeNode(node)) return Object.freeze({ optional: false, type: node });
  const retained = node.types.filter((member) => member.kind !== ts.SyntaxKind.UndefinedKeyword);
  if (retained.length === node.types.length) return Object.freeze({ optional: false, type: node });
  return Object.freeze({
    optional: true,
    type: retained.length === 0
      ? ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
      : retained.length === 1
        ? retained[0]
        : ts.factory.createUnionTypeNode(retained),
  });
}

export function inlinePrivateProtocolObjectProjections(typeText) {
  if (!typeText.includes('ProtocolObjectProjection')) return typeText;
  const source = ts.createSourceFile(
    'actionTypeMap.privateProjection.ts',
    `type ActionProjection = ${typeText};`,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const alias = source.statements[0];
  if (!ts.isTypeAliasDeclaration(alias)) throw new Error('Action projection did not parse as a type alias.');

  const transformed = ts.transform(alias.type, [
    (context) => {
      const visit = (node) => {
        if (!ts.isTypeReferenceNode(node) || typeReferenceName(node) !== 'ProtocolObjectProjection') {
          return ts.visitEachChild(node, visit, context);
        }
        const [shape, projection] = node.typeArguments ?? [];
        const projectionName = projection && ts.isLiteralTypeNode(projection)
          && ts.isStringLiteral(projection.literal)
          ? projection.literal.text
          : undefined;
        if (!shape || !ts.isTypeLiteralNode(shape) || (projectionName !== 'input' && projectionName !== 'output')) {
          throw new Error('ProtocolObjectProjection must retain a structural shape and input/output projection.');
        }
        const projectionIndex = projectionName === 'input' ? 0 : 1;
        return ts.factory.createTypeLiteralNode(shape.members.map((member) => {
          if (!ts.isPropertySignature(member) || !member.type
            || !ts.isTypeReferenceNode(member.type)
            || typeReferenceName(member.type) !== 'ProtocolComposableSchema'
            || member.type.typeArguments?.length !== 2) {
            throw new Error('ProtocolObjectProjection contains a non-composable property.');
          }
          const selected = withoutTopLevelUndefined(member.type.typeArguments[projectionIndex]);
          return ts.factory.createPropertySignature(
            undefined,
            member.name,
            selected.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
            ts.visitNode(selected.type, visit),
          );
        }));
      };
      return (root) => ts.visitNode(root, visit);
    },
  ]);
  try {
    return printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], source);
  } finally {
    transformed.dispose();
  }
}

export function renderActionTypeProjection(name, typeText) {
  const projected = renderPublicActionProjectionType(typeText);
  return name === 'PluginActionInputById'
    ? projected.replace(MUTABLE_PROTOCOL_JSON_VALUE, 'JsonValue')
    : projected;
}

export function renderActionMapProjectionType(checker, type, sourceFile, name, actionIds, onPhase) {
  // TypeScript can expand the mapped Action type once in seconds. Resolving
  // and printing every property separately repeatedly instantiates the same
  // 462-member conditional union and grows superlinearly with the catalog.
  // `validateGeneratedModule` compiles this structural result, compares its
  // exact keys with `actionIds`, and rejects any/unknown values before publish.
  return checker.typeToString(type, undefined, TYPE_FORMAT_FLAGS);
}

function renderProjectionType(checker, type, sourceFile, name, actionIds, onPhase) {
  const typeText = name === 'PluginActionInputById' || name === 'PluginActionResultById'
    ? renderActionMapProjectionType(checker, type, sourceFile, name, actionIds, onPhase)
    : checker.typeToString(type, undefined, TYPE_FORMAT_FLAGS);
  return rewriteProjectedTypeReferences(renderActionTypeProjection(name, typeText));
}

function rewriteProjectedTypeReferences(typeText) {
  return TYPE_PROJECTIONS
    .filter(({ outputName, rewriteReferences }) => rewriteReferences && outputName)
    .reduce(
      (current, { name, outputName }) => current.replaceAll(
        new RegExp(`\\b${name}\\b`, 'gu'),
        outputName,
      ),
      typeText,
    );
}

export async function writeFileIfChanged(path, content) {
  try {
    if (await readFile(path, 'utf8') === content) return false;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(path, content, 'utf8');
  return true;
}

function describeFirstDifference(current, expected) {
  let offset = 0;
  const sharedLength = Math.min(current.length, expected.length);
  while (offset < sharedLength && current[offset] === expected[offset]) offset += 1;
  const line = current.slice(0, offset).split('\n').length;
  const currentLine = current.split('\n')[line - 1] ?? '<end of file>';
  const expectedLine = expected.split('\n')[line - 1] ?? '<end of file>';
  return `first difference at line ${line}: current=${JSON.stringify(currentLine)} expected=${JSON.stringify(expectedLine)}`;
}

function mapKeys(checker, type, name) {
  const keys = checker.getPropertiesOfType(type).map((property) => property.name).sort();
  if (keys.length === 0) throw new Error(`${name} must retain at least one literal Action key.`);
  return keys;
}

function literalStringUnionValues(type, name) {
  const members = type.isUnion() ? type.types : [type];
  const values = members.map((member) => (
    (member.flags & ts.TypeFlags.StringLiteral) !== 0 ? member.value : undefined
  ));
  if (values.some((value) => value === undefined) || values.length === 0) {
    throw new Error(`${name} must remain a non-empty union of literal Action ids.`);
  }
  return values;
}

function assertSameKeys(left, right, description) {
  if (left.length !== right.length || left.some((key, index) => key !== right[index])) {
    throw new Error(`${description} key mismatch: ${JSON.stringify({ left, right })}`);
  }
}

function assertConcreteMapValues(checker, type, sourceFile, name) {
  for (const property of checker.getPropertiesOfType(type)) {
    const location = property.valueDeclaration ?? property.declarations?.[0] ?? sourceFile;
    const value = checker.getTypeOfSymbolAtLocation(property, location);
    if ((value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      throw new Error(`${name}.${property.name} degraded to ${checker.typeToString(value)}.`);
    }
  }
}

export function validateGeneratedModuleSyntax(output) {
  if (PRIVATE_OR_ABSOLUTE_IMPORT.test(output)) {
    throw new Error('Generated Action type map contains a private or absolute import.');
  }
  if (FORBIDDEN_PUBLIC_VALIDATOR_REFERENCE.test(output)) {
    throw new Error('Generated Action type map contains a validator-library implementation reference.');
  }

  const sourceFile = ts.createSourceFile(
    OUTPUT_PATH,
    output,
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TS,
  );
  const diagnostics = sourceFile.parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new Error(
      `Generated Action type map is not valid TypeScript: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`,
    );
  }
}

export function collectGeneratedModuleDiagnostics(program, sourceFile) {
  const canonicalSourcePath = ts.sys.resolvePath(sourceFile.fileName);
  return ts.getPreEmitDiagnostics(program, sourceFile)
    .filter((diagnostic) => (
      diagnostic.file
      && ts.sys.resolvePath(diagnostic.file.fileName) === canonicalSourcePath
    ));
}

export function createGeneratedModuleValidationCompilerOptions(options) {
  return {
    ...options,
    incremental: false,
    noEmit: true,
    // The generated module is already the declaration-shaped structural
    // projection. Declaration-transforming that 29k-line type-only file again
    // adds no correspondence proof and caused the publisher's heap blow-up.
    declaration: false,
    declarationMap: false,
  };
}

export function validateGeneratedModule(output, expectedInputKeys, expectedResultKeys) {
  validateGeneratedModuleSyntax(output);

  const parsed = requireParsedConfig(SDK_TSCONFIG_PATH, 'Plugin SDK');
  const options = createGeneratedModuleValidationCompilerOptions(parsed.options);
  const canonicalOutputPath = ts.sys.resolvePath(OUTPUT_PATH);
  const host = ts.createCompilerHost(options, true);
  const readSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (path) => (
    ts.sys.resolvePath(path) === canonicalOutputPath || ts.sys.fileExists(path)
  );
  host.readFile = (path) => (
    ts.sys.resolvePath(path) === canonicalOutputPath ? output : ts.sys.readFile(path)
  );
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => (
    ts.sys.resolvePath(path) === canonicalOutputPath
      ? ts.createSourceFile(path, output, languageVersion, true, ts.ScriptKind.TS)
      : readSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
  );
  const program = ts.createProgram({
    rootNames: [OUTPUT_PATH],
    options,
    host,
  });
  const sourceFile = program.getSourceFile(OUTPUT_PATH);
  if (!sourceFile) throw new Error('Generated Action type map source is unavailable to the Plugin SDK compiler.');
  const diagnostics = collectGeneratedModuleDiagnostics(program, sourceFile);
  if (diagnostics.length > 0) {
    throw new Error(
      `Generated Action type map does not compile: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n')}`,
    );
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) throw new Error('Generated Action type map has no module symbol.');
  const exports = checker.getExportsOfModule(moduleSymbol);
  const requireGeneratedMap = (name) => {
    const symbol = exports.find((candidate) => candidate.name === name);
    if (!symbol) throw new Error(`Generated Action type map is missing ${name}.`);
    return checker.getDeclaredTypeOfSymbol(symbol);
  };
  const inputMap = requireGeneratedMap('PluginActionInputById');
  const resultMap = requireGeneratedMap('PluginActionResultById');
  const inputKeys = mapKeys(checker, inputMap, 'Generated PluginActionInputById');
  const resultKeys = mapKeys(checker, resultMap, 'Generated PluginActionResultById');
  assertSameKeys(inputKeys, resultKeys, 'Generated Action input/result maps');
  assertSameKeys(inputKeys, expectedInputKeys, 'Protocol/generated Action input maps');
  assertSameKeys(resultKeys, expectedResultKeys, 'Protocol/generated Action result maps');
  assertConcreteMapValues(checker, inputMap, sourceFile, 'Generated PluginActionInputById');
  assertConcreteMapValues(checker, resultMap, sourceFile, 'Generated PluginActionResultById');
}

export function renderStructuralModule(onPhase = () => {}) {
  const { checker, program } = requireProtocolProgram();
  onPhase('protocol-program');
  const actionIdSourceFile = sourceFileFor(
    program,
    'packages/protocol/src/actions/pluginActionSurface.ts',
  );
  const actionIds = literalStringUnionValues(
    projectedType(checker, actionIdSourceFile, { name: 'PluginInvocableActionId' }),
    'Protocol PluginInvocableActionId',
  );
  const projections = TYPE_PROJECTIONS.map((projection) => {
    const sourceFile = sourceFileFor(program, projection.relativePath);
    const type = projectedType(checker, sourceFile, projection);
    const rendered = renderTypeAlias(
      projection.outputName ?? projection.name,
      renderProjectionType(checker, type, sourceFile, projection.name, actionIds, onPhase),
      projection.export,
    );
    onPhase(`projection:${projection.name}`);
    return {
      ...projection,
      sourceFile,
      type,
      rendered,
    };
  });
  const inputMap = projections.find((projection) => projection.name === 'PluginActionInputById');
  const resultMap = projections.find((projection) => projection.name === 'PluginActionResultById');
  if (!inputMap || !resultMap) throw new Error('Action type projections must include exact input and result maps.');
  const inputKeys = [...actionIds].sort();
  const resultKeys = [...actionIds].sort();
  assertSameKeys(inputKeys, resultKeys, 'Protocol Action input/result maps');

  const output = [
    '// This file is generated by scripts/generateActionTypeMap.mjs. Do not edit by hand.',
    '// It contains type-only structural projections of the canonical Protocol Action catalog.',
    '',
    "import type { JsonValue, PluginJsonSchema, PluginJsonValueV2 } from '../identity.js';",
    "import type { AgentExternalSessionTranscriptRawRecord } from '../externalSessions.js';",
    "import type { PluginUiDeclarativeNodeV2 as PluginDeclarativeNodeV2, PluginUiJsonValueV1 } from '../ui/publicContract.js';",
    '',
    ...ACTION_TYPE_CLOSURE,
    '',
    'export type PluginJsonSchemaV2 = PluginJsonSchema;',
    '',
    ...projections.map((projection) => projection.rendered),
    '',
    'export type PluginInvocableActionId = keyof PluginActionInputById;',
    '',
  ].join('\n');
  onPhase('structural-projection');
  return Object.freeze({ inputKeys, output, resultKeys });
}

export function prepareActionTypeMap() {
  const timing = createActionTypeMapTimingReporter();
  const { inputKeys, output, resultKeys } = renderStructuralModule(timing);
  validateGeneratedModule(output, inputKeys, resultKeys);
  timing('generated-module-validation');
  return Object.freeze({ inputKeys, output, resultKeys, timing });
}

export async function publishPreparedActionTypeMap(mode, prepared, { assertOwned }) {
  const { output, timing } = prepared;
  if (mode === '--write') {
    // Structural derivation and validation are synchronous and can outlive a
    // workspace-visible lease after a crashed/paused owner. Fence the only
    // publication point against the current canonical lock owner.
    assertOwned();
    await writeFileIfChanged(OUTPUT_PATH, output);
  } else {
    const current = await readFile(OUTPUT_PATH, 'utf8');
    if (current !== output) {
      throw new Error(
        `Generated Action type map is stale: ${OUTPUT_PATH} (${describeFirstDifference(current, output)}). Run yarn generate:action-type-map.`,
      );
    }
  }
  timing(mode === '--write' ? 'publication-write' : 'publication-check');
}

async function runActionTypeMap(mode, lockContext) {
  return await publishPreparedActionTypeMap(mode, prepareActionTypeMap(), lockContext);
}

export async function runActionTypeMapWithWorkspaceLock({
  mode,
  run,
  prepare = prepareActionTypeMap,
  publish = publishPreparedActionTypeMap,
  lockPath = WORKSPACE_BUILD_LOCK_PATH,
  env = process.env,
  lockOptions = {},
} = {}) {
  if (mode !== '--check' && mode !== '--write') {
    throw new Error('Action type map mode must be --check or --write');
  }
  // Type derivation and semantic validation are read-only and can synchronously
  // occupy the event loop for longer than the shared lock's stale-owner window.
  // Keep only the filesystem publication/check inside the canonical lock so a
  // healthy compiler cannot lose its lease merely because its heartbeat timer
  // could not run.
  const prepared = run ? null : prepare(mode);
  return await withWorkspaceBundleLock(
    async (lockContext) => run
      ? await run(mode, lockContext)
      : await publish(mode, prepared, lockContext),
    {
      ...lockOptions,
      lockPath,
      heldLockValue: lockOptions.heldLockValue
        ?? env.HAPPIER_WORKSPACE_DIST_BUILD_LOCK_HELD,
      errorLabel: lockOptions.errorLabel
        ?? '@happier-dev/plugin-sdk generated Action map lock',
    },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  await runActionTypeMapWithWorkspaceLock({ mode: requireArgument() });
}
