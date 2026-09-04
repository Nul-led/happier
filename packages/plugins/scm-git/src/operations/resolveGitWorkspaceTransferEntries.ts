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

async function listSelectedIgnoredPaths(sourcePath: string, pathspecs: readonly string[]): Promise<readonly string[]> {
    if (pathspecs.length === 0) {
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
            ...pathspecs,
        ],
    });
}

async function listSelectedManagedPaths(sourcePath: string, pathspecs: readonly string[]): Promise<readonly string[]> {
    if (pathspecs.length === 0) {
        return [];
    }

    return await runGitNullSeparatedPathList({
        cwd: sourcePath,
        args: [
            '-C',
            sourcePath,
            'ls-files',
            '-z',
            '--cached',
            '--others',
            '--exclude-standard',
            '--',
            ...pathspecs,
        ],
    });
}

const MAX_WORKSPACE_POLICY_PATTERNS = 128;
const MAX_WORKSPACE_POLICY_PATTERN_LENGTH = 1024;

function validatePolicyPatterns(patterns: readonly string[]): void {
    if (patterns.length > MAX_WORKSPACE_POLICY_PATTERNS
        || patterns.some((pattern) => pattern.length < 1
            || pattern.length > MAX_WORKSPACE_POLICY_PATTERN_LENGTH
            || pattern.includes('\0'))) {
        throw Object.assign(new Error('Workspace seed content policy is invalid'), {
            code: 'git_selection_unavailable',
        });
    }
}

async function listExtraIgnoredPaths(sourcePath: string, patterns: readonly string[]): Promise<readonly string[]> {
    if (patterns.length === 0) return [];
    validatePolicyPatterns(patterns);
    return await runGitNullSeparatedPathList({
        cwd: sourcePath,
        args: [
            '-C',
            sourcePath,
            'ls-files',
            '-z',
            '--cached',
            '--others',
            '-i',
            ...patterns.map((pattern) => `--exclude=${pattern}`),
            '--',
            '.',
        ],
    });
}

export async function resolveGitWorkspaceTransferEntries(input: ScmWorkspaceIntegrationWorkspaceTransferInput): Promise<readonly ScmWorkspaceIntegrationWorkspaceTransferEntry[]> {
    const sourcePath = input.context.cwd;
    const relativePaths = new Set(await listGitManagedPaths(sourcePath));

    if (input.workspaceTransfer.includeAllIgnored === true) {
        for (const relativePath of await listSelectedIgnoredPaths(sourcePath, ['.'])) {
            relativePaths.add(relativePath);
        }
    }

    for (const relativePath of await listExtraIgnoredPaths(
        sourcePath,
        input.workspaceTransfer.extraIgnorePatterns ?? [],
    )) {
        relativePaths.delete(relativePath);
    }

    // Explicit re-includes have final precedence, matching the continuous
    // Git-worktree policy compiled by the Mutagen owner.
    if (input.workspaceTransfer.includeIgnoredMode === 'include_selected') {
        const explicitIncludes = [...input.workspaceTransfer.ignoredIncludeGlobs];
        validatePolicyPatterns(explicitIncludes);
        for (const relativePath of await listSelectedManagedPaths(sourcePath, explicitIncludes)) {
            relativePaths.add(relativePath);
        }
        for (const relativePath of await listSelectedIgnoredPaths(sourcePath, explicitIncludes)) {
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
