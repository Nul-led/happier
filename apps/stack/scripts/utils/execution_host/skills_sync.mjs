import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { runCaptureResult } from '../proc/proc.mjs';
import {
  resolveExecutionHostGuestHome,
  resolveExecutionHostWorkspaceMount,
} from './workspace_mount.mjs';

const SKILL_ROOTS = Object.freeze([
  Object.freeze({ id: 'codex', relativePath: '.codex/skills' }),
  Object.freeze({ id: 'agents', relativePath: '.agents/skills' }),
  Object.freeze({ id: 'claude', relativePath: '.claude/skills' }),
]);

function defaultBoundary(env) {
  return {
    capture: (command, args, options = {}) => runCaptureResult(command, args, { env, ...options }),
    start: (command, args) => {
      const child = spawn(command, args, {
        env,
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
      child.unref();
      return child;
    },
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function failureDetail(result) {
  return String(result?.err ?? '').trim() || `exit ${result?.exitCode ?? 'unknown'}`;
}

async function collectUnmaterializableLinks(root, directory = root, ancestorRealPaths = new Set()) {
  const directoryRealPath = await realpath(directory);
  const ancestry = new Set(ancestorRealPaths).add(directoryRealPath);
  const skipped = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try {
        target = await stat(path);
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ELOOP') {
          skipped.push(relative(root, path).split(sep).join('/'));
          continue;
        }
        throw error;
      }
      if (target.isDirectory()) {
        const targetRealPath = await realpath(path);
        if (ancestry.has(targetRealPath)) {
          skipped.push(relative(root, path).split(sep).join('/'));
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        skipped.push(...await collectUnmaterializableLinks(root, path, ancestry));
      }
      continue;
    }
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      skipped.push(...await collectUnmaterializableLinks(root, path, ancestry));
    }
  }
  return skipped;
}

export async function syncExecutionHostSkills({
  profile,
  executor,
  env = process.env,
  hostHomeDir = homedir(),
  boundary,
  fileExists = existsSync,
} = {}) {
  const processBoundary = boundary ?? defaultBoundary(env);
  const mount = resolveExecutionHostWorkspaceMount(profile, env);
  const guestHome = await resolveExecutionHostGuestHome({ profile, executor });
  const roots = SKILL_ROOTS.map((root) => ({
    ...root,
    source: join(hostHomeDir, root.relativePath),
    destination: join(guestHome, root.relativePath),
  }));
  const present = roots.filter((root) => fileExists(root.source));
  if (present.length > 0) {
    const mkdirResult = await executor.capture('limactl', [
      'shell', profile.instance, '--', 'mkdir', '-p', ...present.map((root) => root.destination),
    ]);
    if (mkdirResult.exitCode !== 0) {
      throw new Error(`[dev-vm] unable to prepare guest skill directories: ${failureDetail(mkdirResult)}`);
    }
  }
  const sshCommand = [
    'ssh',
    '-F', shellQuote(mount.sshConfigFile),
    '-o', 'ControlMaster=no',
    '-o', 'ControlPath=none',
  ].join(' ');
  const results = [];
  for (const root of roots) {
    if (!fileExists(root.source)) {
      results.push({ id: root.id, status: 'missing', source: root.source, destination: root.destination });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const skippedLinks = await collectUnmaterializableLinks(root.source);
    // Materialize links so absolute Mac paths never leak into the Linux home.
    // Each present root is an exact one-way projection; a missing host root is
    // skipped above so transient absence cannot erase guest-owned data.
    // eslint-disable-next-line no-await-in-loop
    const result = await processBoundary.capture('rsync', [
      '--archive',
      '--copy-links',
      '--delete-delay',
      '--delete-excluded',
      ...skippedLinks.flatMap((path) => ['--exclude', path]),
      '--protect-args',
      '--rsh', sshCommand,
      '--',
      `${root.source}/`,
      `${mount.sshHost}:${root.destination}/`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`[dev-vm] ${root.id} skill synchronization failed: ${failureDetail(result)}`);
    }
    results.push({
      id: root.id,
      status: 'synced',
      source: root.source,
      destination: root.destination,
      skippedLinks,
    });
  }
  return { status: 'synced', roots: results };
}

export function startDetachedExecutionHostSkillsSync({
  programArgs,
  env = process.env,
  boundary,
} = {}) {
  if (!Array.isArray(programArgs) || programArgs.length < 2) {
    throw new Error('[dev-vm] detached skill synchronization requires a repo-local program invocation');
  }
  const [program, ...args] = programArgs;
  const child = (boundary ?? defaultBoundary(env)).start(program, args);
  return { status: 'started', pid: Number.isInteger(child?.pid) ? child.pid : null };
}
