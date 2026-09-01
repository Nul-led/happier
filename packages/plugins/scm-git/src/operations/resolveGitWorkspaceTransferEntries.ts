import { join } from 'node:path';

import type { ScmWorkspaceIntegrationWorkspaceTransferInput } from '../types.js';
import {
    createScmWorkspaceIntegrationWorkspaceTransferEntry,
    type ScmWorkspaceIntegrationWorkspaceTransferEntry,
} from '../workspace/workspaceTransfer.js';
import { runScmCommand } from '../runtime.js';

function normalizeRelativePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

const DEFAULT_GIT_LS_FILES_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

function resolveGitLsFilesMaxOutputBytes(): number {
    const rawEnv = process.env.HAPPIER_SCM_GIT_LS_FILES_MAX_OUTPUT_BYTES;
    if (!rawEnv) return DEFAULT_GIT_LS_FILES_MAX_OUTPUT_BYTES;
    const parsed = Number(rawEnv);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_GIT_LS_FILES_MAX_OUTPUT_BYTES;
    }
    return Math.floor(parsed);
}

async function runGitNullSeparatedPathList(params: Readonly<{
    cwd: string;
    args: readonly string[];
    maxStdoutBytes?: number;
}>): Promise<readonly string[]> {
    const maxStdoutBytes = params.maxStdoutBytes ?? resolveGitLsFilesMaxOutputBytes();
    const result = await runScmCommand({
        bin: 'git',
        cwd: params.cwd,
        args: [...params.args],
        maxOutputBytes: maxStdoutBytes,
    });
    if (!result.success) {
        throw new Error((result.stderr || `git exited with code ${result.exitCode}`).trim());
    }

    return result.stdout
        .split('\0')
        .map(normalizeRelativePath)
        .filter((entry) => entry.length > 0);
}

async function listGitManagedPaths(sourcePath: string): Promise<readonly string[]> {
    return await runGitNullSeparatedPathList({
        cwd: sourcePath,
        args: ['-C', sourcePath, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    });
}

async function listSelectedIgnoredPaths(sourcePath: string, ignoredIncludeGlobs: readonly string[]): Promise<readonly string[]> {
    if (ignoredIncludeGlobs.length === 0) {
        return [];
    }

    return await runGitNullSeparatedPathList({
        cwd: sourcePath,
        args: [
            '-C',
            sourcePath,
            'ls-files',
            '-z',
            '--others',
            '-i',
            '--exclude-standard',
            '--',
            ...ignoredIncludeGlobs,
        ],
    });
}

export async function resolveGitWorkspaceTransferEntries(input: ScmWorkspaceIntegrationWorkspaceTransferInput): Promise<readonly ScmWorkspaceIntegrationWorkspaceTransferEntry[]> {
    const sourcePath = input.context.cwd;
    const relativePaths = new Set(await listGitManagedPaths(sourcePath));

    if (input.workspaceTransfer.includeIgnoredMode === 'include_selected') {
        for (const relativePath of await listSelectedIgnoredPaths(sourcePath, [...input.workspaceTransfer.ignoredIncludeGlobs])) {
            relativePaths.add(relativePath);
        }
    }

    // Checkout administration is machine-local state, not workspace content.
    // Portable checkout bootstrap belongs to the SCM materialization owner.
    const entries = [
        ...[...relativePaths]
            .sort((left, right) => left.localeCompare(right))
            .map((relativePath) => createScmWorkspaceIntegrationWorkspaceTransferEntry({
                relativePath,
                sourcePath: join(sourcePath, relativePath),
            })),
    ];

    return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
