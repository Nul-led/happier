import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIRST_PARTY_ROOTS = ['apps', 'packages'];

function readConfiguredBudget(): number {
    const config = readFileSync(path.join(REPOSITORY_ROOT, '.codex/config.toml'), 'utf8');
    const match = config.match(/^project_doc_max_bytes\s*=\s*(\d+)\s*$/m);
    assert.ok(match, '.codex/config.toml must declare project_doc_max_bytes');
    return Number(match[1]);
}

function collectPackageAgentFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory()) {
            return [];
        }
        const candidate = path.join(directory, entry.name, 'AGENTS.md');
        return statSync(candidate, { throwIfNoEntry: false })?.isFile() ? [candidate] : [];
    });
}

function instructionChainBytes(agentFile: string): number {
    let directory = path.dirname(agentFile);
    let total = 0;

    while (directory.startsWith(REPOSITORY_ROOT)) {
        const candidate = path.join(directory, 'AGENTS.md');
        if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
            total += statSync(candidate).size;
        }
        if (directory === REPOSITORY_ROOT) {
            break;
        }
        directory = path.dirname(directory);
    }

    return total;
}

test('Codex project instruction budget covers every first-party AGENTS.md chain', () => {
    const agentFiles = FIRST_PARTY_ROOTS.flatMap((directory) =>
        collectPackageAgentFiles(path.join(REPOSITORY_ROOT, directory)),
    );
    assert.ok(agentFiles.length > 0, 'expected at least one first-party package AGENTS.md');

    const largest = agentFiles
        .map((agentFile) => ({ agentFile, bytes: instructionChainBytes(agentFile) }))
        .sort((left, right) => right.bytes - left.bytes)[0];
    const budget = readConfiguredBudget();

    assert.ok(
        largest.bytes <= budget,
        `${path.relative(REPOSITORY_ROOT, largest.agentFile)} needs ${largest.bytes} bytes, exceeding project_doc_max_bytes=${budget}`,
    );
});
