import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveWorkspacePackageSource } from '../../../scripts/testing/vitestWorkspacePackageResolution.ts';
import { bundleWorkspacePackageDependencies } from '../../../scripts/workspaces/bundleWorkspacePackageDependencies.mjs';

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(sdkDir, '..', '..');
const consumerApiToken = 'hap_v1_123e4567-e89b-42d3-a456-426614174000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function sourceConsumerPaths(httpCondition = 'node', { includeWorkspaceSources = false } = {}) {
  const paths = {};
  // The SDK is checked from current public source. Its dependencies retain
  // their package-owned compiler semantics and expose their normal built
  // declarations through exports.types, exactly as an external consumer sees
  // them. Runtime smoke still loads the moving workspace implementation.
  const names = includeWorkspaceSources
    ? ['sdk', 'protocol', 'agents', 'session-core', 'sync-client', 'connection-supervisor']
    : ['sdk'];
  for (const name of names) {
    const root = join(repoRoot, 'packages', name);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    for (const exported of Object.keys(manifest.exports)) {
      const specifier = exported === '.' ? manifest.name : `${manifest.name}${exported.slice(1)}`;
      const source = resolveWorkspacePackageSource(specifier, manifest.name, join(root, 'src'), {
        exportConditions: [httpCondition === 'node' ? 'node' : 'browser'],
      });
      if (source) paths[specifier] = [source];
    }
    if (name === 'sdk') {
      const http = manifest.imports['#http'][httpCondition];
      paths['#http'] = [join(root, http.replace('./dist/', './src/').replace(/\.js$/u, '.ts'))];
    }
  }
  return paths;
}

function run(command, args, cwd, { env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error([`${command} ${args.join(' ')} failed with status ${result.status}`, result.stdout, result.stderr].filter(Boolean).join('\n'));
  return result.stdout.trim();
}

export function parseNodeNextConsumerArgs(argv) {
  const { values } = parseArgs({ args: argv, options: { tarball: { type: 'string', default: '' } }, allowPositionals: false });
  const tarball = String(values.tarball ?? '').trim();
  if (!tarball) return Object.freeze({ tarballPath: null });
  if (!isAbsolute(tarball)) throw new Error('SDK consumer tarball path must be absolute');
  return Object.freeze({ tarballPath: resolve(tarball) });
}

async function assertExactTarball(tarballPath) {
  const stats = await lstat(tarballPath).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`SDK consumer tarball does not exist: ${tarballPath}`);
    throw error;
  });
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`SDK consumer tarball must be an exact regular file: ${tarballPath}`);
  return tarballPath;
}

export async function validateNodeNextConsumer({ tarballPath = null } = {}) {
  const fixture = await mkdtemp(join(tmpdir(), 'happier-sdk-nodenext-'));
  try {
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'happier-sdk-nodenext-consumer', private: true, type: 'module' }, null, 2));
    const sourceMode = tarballPath === null;
    if (sourceMode) {
      // Reuse the workspace build owner's current-input readiness and normal
      // live dependency publication. Missing or failed dependency builds must
      // fail this check; stale ignored declarations cannot certify the SDK.
      await bundleWorkspacePackageDependencies({
        repoRoot, hostPackageDir: sdkDir, publicationMode: 'live', quiet: true,
      });
    }
    const paths = sourceMode ? await sourceConsumerPaths() : undefined;
    await writeFile(join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true,
        skipLibCheck: false, lib: ['ES2022', 'DOM'], types: ['node'],
        typeRoots: [join(repoRoot, 'node_modules', '@types')],
        ...(sourceMode ? { paths } : {}),
      },
      include: ['consumer.ts'],
    }, null, 2));
    await writeFile(join(fixture, 'consumer.ts'), [
      "import { connect, isHappierActionApprovalRequestCreated, type HappierSessionController, type HappierSessionLiveOptions, type HappierSessionSnapshot, type PublicActionId, type PublicActionInputById } from '@happier-dev/sdk';",
      "type AssertNever<T extends never> = T;",
      "type HumanCredentialLifecycleActionId = 'account.password.enroll' | 'account.password.change' | 'account.password.remove' | 'account.email.change.request' | 'account.apiTokens.create' | 'account.apiTokens.list' | 'account.apiTokens.revoke' | 'account.apiTokens.revokeAll';",
      "type HumanCredentialLifecycleActionsStayPrivate = AssertNever<Extract<PublicActionId, HumanCredentialLifecycleActionId>>;",
      "void (0 as unknown as HumanCredentialLifecycleActionsStayPrivate);",
      "const actionId: PublicActionId = 'machines.list';",
      `const client = connect({ endpoint: 'http://127.0.0.1:3210', token: ${JSON.stringify(consumerApiToken)} });`,
      'void client.actions.execute(actionId, {});', 'void client.machines.list();',
      'void client.actions.account.security.get({});',
      'async function exerciseEmbed() {',
      '  const config = await client.embed.get();',
      "  const session = await client.embed.createSession({ title: 'Lead', initialMessage: 'Review the lead', permissionMode: 'default' }, { requestId: 'lead-creation' });",
      '  const listed = await client.embed.listSessions({ folderId: config.organization.folderId, tagIds: config.organization.tagIds });',
      "  const credential = await client.embed.createCredential({ sessionId: session.id, embedPublicKey: 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9_AsrhtHHw', expiresInSeconds: 900 });",
      '  const tokenId: string = credential.tokenId;',
      '  return { listed, tokenId };',
      '}',
      'void exerciseEmbed;',
      'async function exerciseInteractiveRun(',
      '  sessionId: string,',
      "  selection: Pick<PublicActionInputById['execution.run.start'], 'backendTarget' | 'permissionMode'>,",
      ') {',
      '  const started = await client.actions.execution.run.start({',
      '    ...selection, sessionId,',
      "    intent: 'delegate', runClass: 'long_lived', retentionPolicy: 'resumable', ioMode: 'streaming',",
      '  });',
      '  if (isHappierActionApprovalRequestCreated(started)) return;',
      '  const run = client.sessions.get(sessionId).runs.get(started.runId);',
      "  await run.send('Inspect the issue.');",
      "  await run.sendAndWait('Summarize the result.', { localId: 'consumer-followup', timeoutSeconds: 300 });",
      '  const history = await run.history({ limit: 50 });',
      '  await run.stop();',
      '  const terminal = await run.wait({ timeoutSeconds: 300 });',
      '  return { history, terminal };',
      '}',
      'void exerciseInteractiveRun;',
      'async function exerciseLiveSession(',
      '  sessionId: string,',
      "  answers: Parameters<HappierSessionController['answerUserAction']>[1],",
      '  options: HappierSessionLiveOptions = {},',
      ') {',
      '  const controller: HappierSessionController = await client.sessions.get(sessionId).live(options);',
      '  const readMessages = () => {',
      '    const snapshot: HappierSessionSnapshot = controller.getSnapshot();',
      '    return snapshot.transcript.messageIdsOldestFirst.map((id) => snapshot.transcript.messagesById[id]);',
      '  };',
      '  const unsubscribe = controller.subscribe(() => { void readMessages(); });',
      '  try {',
      '    await controller.loadOlder({ signal: options.signal });',
      "    await controller.send('Continue reviewing.', { localId: 'consumer-live', signal: options.signal });",
      "    await controller.respondToPermission({ id: 'permission-1', approved: true, decision: 'approved_for_session' }, { signal: options.signal });",
      "    await controller.answerUserAction('question-1', answers, { signal: options.signal });",
      '    await controller.abort({ signal: options.signal });',
      '    return readMessages();',
      '  } finally {',
      '    unsubscribe();',
      '    await controller.close();',
      '  }',
      '}',
      'void exerciseLiveSession;',
      'await client.close();', '',
    ].join('\n'));

    if (sourceMode) {
      run(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '--noEmit', '-p', join(fixture, 'tsconfig.json')], repoRoot);
      const browserTsconfigPath = join(fixture, 'browser.tsconfig.json');
      await writeFile(browserTsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
          strict: true, noEmit: true, skipLibCheck: false, lib: ['ES2022', 'DOM'], types: [],
          paths: await sourceConsumerPaths('default'),
        },
        files: [join(fixture, 'consumer.ts')],
      }, null, 2));
      run(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '--noEmit', '-p', browserTsconfigPath], repoRoot);
      for (const exampleName of ['basic', 'comprehensive', 'external-plugin', 'child-token']) {
        const exampleTsconfigPath = join(fixture, `example-${exampleName}.tsconfig.json`);
        await writeFile(exampleTsconfigPath, JSON.stringify({
          compilerOptions: {
            target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true,
            skipLibCheck: false, lib: ['ES2022', 'DOM'], types: ['node'],
            typeRoots: [join(repoRoot, 'node_modules', '@types')],
            paths,
          },
          files: [join(sdkDir, 'examples', exampleName, 'index.ts')],
        }, null, 2));
        run(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '--noEmit', '-p', exampleTsconfigPath], repoRoot);
      }
      const runtimeTsconfigPath = join(fixture, 'runtime.tsconfig.json');
      await writeFile(runtimeTsconfigPath, JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
          // tsx's loader requires a base for absolute aliases, including cross-drive Windows targets.
          // This loader-only config is never passed to the native TypeScript compiler.
          baseUrl: '.',
          paths: await sourceConsumerPaths('node', { includeWorkspaceSources: true }),
        },
      }, null, 2));
      run(process.execPath, ['--import', join(repoRoot, 'node_modules/tsx/dist/loader.mjs'), '--input-type=module', '--eval', [
        `import { connect } from ${JSON.stringify(pathToFileURL(join(sdkDir, 'src/index.public.ts')).href)};`,
        `const client = connect({ endpoint: 'http://127.0.0.1:3210', token: ${JSON.stringify(consumerApiToken)} });`, 'await client.close();',
      ].join('\n')], repoRoot, {
        env: { ...process.env, TSX_TSCONFIG_PATH: runtimeTsconfigPath },
      });
      return;
    }

    const tarball = await assertExactTarball(tarballPath);
    run('npm', ['install', '--ignore-scripts', '--no-package-lock', tarball], fixture);
    run(process.execPath, [join(repoRoot, 'scripts/workspaces/runTypeScriptCli.mjs'), '--noEmit', '-p', join(fixture, 'tsconfig.json')], repoRoot);
    run(process.execPath, ['--input-type=module', '--eval', `import { connect } from '@happier-dev/sdk'; const client = connect({ endpoint: 'http://127.0.0.1:3210', token: ${JSON.stringify(consumerApiToken)} }); await client.close();`], fixture);
    const installed = JSON.parse(await readFile(join(fixture, 'node_modules/@happier-dev/sdk/package.json'), 'utf8'));
    if (installed.name !== '@happier-dev/sdk') throw new Error('Installed SDK package identity mismatch');
  } finally { await rm(fixture, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2)) {
  const { tarballPath } = parseNodeNextConsumerArgs(argv);
  await validateNodeNextConsumer({ tarballPath });
}
const invokedAsMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedAsMain) await main();
