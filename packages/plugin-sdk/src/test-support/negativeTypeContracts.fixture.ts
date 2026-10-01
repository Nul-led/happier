import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import ts from 'typescript';

type NegativeTypeCase = Readonly<{
    id: string;
    reason: string;
    fileName: string;
    start: number;
    end: number;
}>;

const CASE_PATTERN = /\/\* @sdk-negative-type-case:([^:]+):([^:]+):([^ ]+) \*\/[\s\S]*?\/\* @sdk-negative-type-case-end \*\//gu;

function sourceFilesBelow(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFilesBelow(path);
        return entry.isFile() && path.endsWith('.ts') ? [path] : [];
    });
}

function decode(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function reconstructNegativeTypeCases(
    fileName: string,
    source: string,
): Readonly<{ source: string; cases: readonly NegativeTypeCase[] }> {
    const cases: NegativeTypeCase[] = [];
    let output = '';
    let previousEnd = 0;

    for (const match of source.matchAll(CASE_PATTERN)) {
        const matchStart = match.index;
        output += source.slice(previousEnd, matchStart);
        const code = decode(match[3]);
        const start = output.length;
        output += code;
        cases.push({
            id: match[1],
            reason: decode(match[2]),
            fileName,
            start,
            end: output.length,
        });
        previousEnd = matchStart + match[0].length;
    }
    output += source.slice(previousEnd);
    return { source: output, cases };
}

export type NegativeTypeContractsFixtureResult = Readonly<{
    caseCount: number;
    syntacticDiagnostics: readonly Readonly<{ fileName: string; message: string }>[];
    missing: readonly Readonly<{ id: string; reason: string }>[];
    unexpectedFiles: readonly Readonly<{ fileName: string; message: string }>[];
}>;

export function evaluateNegativeTypeContracts(sourceRoot: string): NegativeTypeContractsFixtureResult {
    const reconstructedSources = new Map<string, string>();
    const cases: NegativeTypeCase[] = [];

    for (const fileName of sourceFilesBelow(sourceRoot)) {
        const source = readFileSync(fileName, 'utf8');
        if (!source.includes('@sdk-negative-type-case:')) continue;
        const reconstructed = reconstructNegativeTypeCases(fileName, source);
        reconstructedSources.set(fileName, reconstructed.source);
        cases.push(...reconstructed.cases);
    }

    const configPath = resolve(sourceRoot, '../tsconfig.tests.json');
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
    }
    const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        dirname(configPath),
        undefined,
        configPath,
    );
    const host = ts.createCompilerHost(parsed.options);
    const readFile = host.readFile.bind(host);
    host.readFile = (fileName) => reconstructedSources.get(resolve(fileName)) ?? readFile(fileName);
    host.getSourceFile = (fileName, languageVersionOrOptions) => {
        const sourceText = host.readFile(fileName);
        return sourceText === undefined
            ? undefined
            : ts.createSourceFile(
                fileName,
                sourceText,
                languageVersionOrOptions,
                true,
                fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
            );
    };

    const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
        host,
    });
    const syntacticDiagnostics = program.getSyntacticDiagnostics();
    const diagnostics = program.getSemanticDiagnostics();
    return {
        caseCount: cases.length,
        syntacticDiagnostics: syntacticDiagnostics.map((diagnostic) => ({
            fileName: diagnostic.file?.fileName ?? '<global>',
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        })),
        missing: cases
            .filter((negativeCase) => !diagnostics.some((diagnostic) => (
                diagnostic.file?.fileName === negativeCase.fileName
                && diagnostic.start !== undefined
                && negativeCase.start <= diagnostic.start
                && diagnostic.start <= negativeCase.end
            )))
            .map(({ id, reason }) => ({ id, reason })),
        unexpectedFiles: diagnostics
            .filter((diagnostic) => (
                diagnostic.file === undefined
                || !reconstructedSources.has(diagnostic.file.fileName)
            ))
            .map((diagnostic) => ({
                fileName: diagnostic.file?.fileName ?? '<global>',
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
            })),
    };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
    process.stdout.write(`${JSON.stringify(evaluateNegativeTypeContracts(resolve(import.meta.dirname, '..')))}\n`);
}
