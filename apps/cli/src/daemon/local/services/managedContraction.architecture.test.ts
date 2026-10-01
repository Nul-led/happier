import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CLI_ROOT = path.resolve(__dirname, '../../../..');
const SOURCE_ROOT = path.join(CLI_ROOT, 'src');

function productionFiles(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) {
            return ['node_modules', '__tests__', '__testdata__'].includes(entry.name) ? [] : productionFiles(file);
        }
        return /\.tsx?$/.test(file) && !/\.(test|spec|d)\.tsx?$/.test(file) ? [file] : [];
    });
}

function removedManagedImports(file: string, text: string): string[] {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports: string[] = [];
    const inspect = (node: ts.Node): void => {
        let specifier: ts.Node | undefined;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
            || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
        if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier))) {
            const resolved = specifier.text.startsWith('.')
                ? path.resolve(path.dirname(file), specifier.text)
                : specifier.text.startsWith('@/') ? path.join(SOURCE_ROOT, specifier.text.slice(2)) : specifier.text;
            if (/(^|\/)daemon\/local\/services\/managed(\/|$)/i.test(resolved.replaceAll('\\', '/'))) {
                imports.push(specifier.text);
            }
        }
        ts.forEachChild(node, inspect);
    };
    inspect(source);
    return imports;
}

describe('managed local-services host contraction', () => {
    it('rejects retired host ownership from every production CLI entry, preserving plugin supervision', () => {
        expect(existsSync(path.join(SOURCE_ROOT, 'daemon/local/services/managed'))).toBe(false);
        const offenders = productionFiles(SOURCE_ROOT).flatMap((file) =>
            removedManagedImports(file, readFileSync(file, 'utf8')).map((specifier) => `${path.relative(CLI_ROOT, file)} -> ${specifier}`));
        expect(offenders).toEqual([]);
        // These leaves own real plugin-declared processes and their discovered endpoints;
        // they are not the producerless daemon-managed service registry removed by DEC-6.
        expect(existsSync(path.join(SOURCE_ROOT, 'plugins/runtime/invocation/services/managedOwnedTreeEndpoint.ts'))).toBe(true);
        expect(existsSync(path.join(SOURCE_ROOT, 'plugins/runtime/invocation/services/managedServicesOwner.ts'))).toBe(true);
    });

    it('detects static reimports without a content prefilter, including barrel and dynamic forms', () => {
        const file = path.join(SOURCE_ROOT, 'index.ts');
        expect(removedManagedImports(file, [
            "export { x } from './daemon/local/services/managed/registry';",
            "import type { Y } from '@/daemon/local/services/managed/types';",
            "void import(`./daemon/local/services/managed/routes`);",
            "const a = require('./daemon/local/services/managed/actions');",
            "import b = require('./daemon/local/services/managed/runtime');",
            "import { live } from './plugins/runtime/invocation/services/managedServicesOwner';",
        ].join('\n'))).toEqual([
            './daemon/local/services/managed/registry', '@/daemon/local/services/managed/types',
            './daemon/local/services/managed/routes', './daemon/local/services/managed/actions',
            './daemon/local/services/managed/runtime',
        ]);
    });
});
