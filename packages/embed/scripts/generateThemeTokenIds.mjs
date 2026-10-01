import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owner = new URL('../../../apps/ui/sources/theme/tokens/themeColorTokenDefinitions.ts', import.meta.url);
const target = new URL('../src/themeTokenIds.ts', import.meta.url);
const themeOwner = new URL('../../../apps/ui/sources/theme/index.ts', import.meta.url);
const motionOwner = new URL('../../plugin-ui/src/presentation/interaction/motion.ts', import.meta.url);
const scalesOwner = new URL('../../../apps/ui/sources/theme/themeStyleScales.ts', import.meta.url);
const composerOwner = new URL('../../../apps/ui/sources/components/sessions/agentInput/AgentInput.tsx', import.meta.url);
const chromeOwner = new URL('../../../apps/ui/sources/components/sessions/agentInput/components/agentInputChromeStyles.ts', import.meta.url);
const widthOwner = new URL('../../../apps/ui/sources/components/ui/layout/contentWidthMode.ts', import.meta.url);

function unwrap(expression) {
  while (expression) {
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) expression = expression.expression;
    else if (ts.isCallExpression(expression)) expression = expression.arguments[0];
    else if (ts.isArrowFunction(expression)) expression = expression.body;
    else break;
  }
  return expression;
}

function literalValue(expression, parsed) {
  expression = unwrap(expression);
  if (expression && ts.isStringLiteral(expression)) return expression.text;
  if (expression && ts.isNumericLiteral(expression)) return Number(expression.text);
  if (expression && ts.isArrayLiteralExpression(expression)) return expression.elements.map((value) => literalValue(value, parsed));
  if (expression && ts.isObjectLiteralExpression(expression)) return Object.fromEntries(expression.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) throw new Error('Canonical projection requires literal properties');
    return [property.name.getText(parsed), literalValue(property.initializer, parsed)];
  }));
  throw new Error('Canonical projection is no longer a literal; update its projection');
}

function readLiteral(source, variable, path) {
  const parsed = ts.createSourceFile('owner.ts', source, ts.ScriptTarget.Latest, true);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variable) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const name of path) {
    expression = unwrap(expression);
    if (!expression || !ts.isObjectLiteralExpression(expression)) throw new Error(`No canonical ${variable}.${path.join('.')}`);
    const property = expression.properties.find((node) => ts.isPropertyAssignment(node) && node.name.getText(parsed) === name);
    expression = property?.initializer;
  }
  return literalValue(expression, parsed);
}

function readComposerHorizontalPadding(source) {
  const parsed = ts.createSourceFile('AgentInput.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selection;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === 'paddingHorizontal' && ts.isBinaryExpression(node.initializer) && node.initializer.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const candidate = unwrap(node.initializer.right);
      if (candidate && ts.isConditionalExpression(candidate) && ts.isBinaryExpression(candidate.condition) && candidate.condition.left.getText(parsed) === 'screenWidth' && candidate.condition.operatorToken.kind === ts.SyntaxKind.GreaterThanToken) selection = candidate;
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (!selection) throw new Error('Canonical composer horizontal padding changed; update its projection');
  return { breakpoint: literalValue(selection.condition.right, parsed), wide: literalValue(selection.whenTrue, parsed), narrow: literalValue(selection.whenFalse, parsed) };
}

export function renderPlaceholderTheme(themeSource, motionSource, scalesSource, composerSource, chromeSource, widthSource) {
  const defaults = {
    light: { canvas: readLiteral(themeSource, 'lightTheme', ['colors', 'background', 'canvas']), skeleton: readLiteral(themeSource, 'lightTheme', ['colors', 'surface', 'inset']) },
    dark: { canvas: readLiteral(themeSource, 'darkTheme', ['colors', 'background', 'canvas']), skeleton: readLiteral(themeSource, 'darkTheme', ['colors', 'surface', 'inset']) },
    radiusScales: readLiteral(scalesSource, 'RADIUS_SCALES', []),
    composerRadiusStep: readLiteral(scalesSource, 'PART_RADIUS_STEPS', ['composer']),
    horizontalPadding: readComposerHorizontalPadding(composerSource),
    bottom: readLiteral(composerSource, 'stylesheet', ['container', 'paddingBottom']),
    maxWidth: readLiteral(widthSource, 'CONTENT_WIDTH_PX_BY_MODE', ['compact']),
    // Empty single-row panel: incumbent input floor + action chip + panel chrome.
    height: readLiteral(composerSource, 'stylesheet', ['inputContainer', 'minHeight']) + readLiteral(chromeSource, 'AGENT_INPUT_ACTION_CHIP_STYLE', ['height']) + readLiteral(chromeSource, 'AGENT_INPUT_PANEL_PADDING_TOP', []) + readLiteral(chromeSource, 'AGENT_INPUT_PANEL_PADDING_BOTTOM', []),
    fadeMs: readLiteral(motionSource, 'HAPPIER_MOTION_V1', ['fastMs']),
    easingCss: `cubic-bezier(${readLiteral(motionSource, 'STANDARD_BEZIER', []).join(', ')})`,
  };
  return `export const EMBED_PLACEHOLDER_THEME = ${JSON.stringify(defaults, null, 2)} as const;\n`;
}

async function renderCurrent() {
  const [tokens, theme, motion, scales, composer, chrome, width] = await Promise.all([owner, themeOwner, motionOwner, scalesOwner, composerOwner, chromeOwner, widthOwner].map((path) => readFile(path, 'utf8')));
  return renderThemeTokenIds(tokens) + renderPlaceholderTheme(theme, motion, scales, composer, chrome, width);
}

export function renderThemeTokenIds(source) {
  const parsed = ts.createSourceFile('themeColorTokenDefinitions.ts', source, ts.ScriptTarget.Latest, true);
  const ids = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineEditableThemeColorToken') {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const id = argument.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(parsed) === 'id');
        if (id && ts.isPropertyAssignment(id) && ts.isStringLiteral(id.initializer)) ids.push(id.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error('Canonical theme color tokens are empty or duplicated');
  return `// Generated from apps/ui/sources/theme/tokens/themeColorTokenDefinitions.ts.\n// Run node packages/embed/scripts/generateThemeTokenIds.mjs --write after owner changes.\nexport const EMBED_COLOR_TOKEN_IDS = ${JSON.stringify(ids.sort(), null, 2)} as const;\nexport type EmbedColorTokenId = typeof EMBED_COLOR_TOKEN_IDS[number];\n`;
}

export async function checkThemeTokenIds() {
  const expected = await renderCurrent();
  const actual = await readFile(target, 'utf8');
  if (actual !== expected) throw new Error('Embed theme color token IDs drifted from the canonical UI theme owner');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) await writeFile(target, await renderCurrent());
  else await checkThemeTokenIds();
}
