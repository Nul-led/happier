import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('install.sh asset lookup works even when awk has a line-length limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-installer-asset-lookup-'));
  const binDir = join(root, 'bin');
  const installDir = join(root, 'install');
  const outBinDir = join(root, 'out-bin');
  await mkdir(binDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(outBinDir, { recursive: true });

  const unameStubPath = join(binDir, 'uname');
  await writeFile(
    unameStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "-s" ]]; then
  echo Linux
  exit 0
fi
if [[ "$1" = "-m" ]]; then
  echo x86_64
  exit 0
fi
echo Linux
`,
    'utf8',
  );
  await chmod(unameStubPath, 0o755);

  // Simulate an awk implementation with a max line-length limit by refusing to process inputs that
  // contain any "very long" lines. This catches jq-free parsing that collapses JSON into a single
  // huge line (e.g. via `tr -d '[:space:]'`).
  const awkWrapperPath = join(binDir, 'awk');
  await writeFile(
    awkWrapperPath,
    `#!/usr/bin/env bash
set -euo pipefail

real_awk="/usr/bin/awk"
awk_flags=()
if command -v gawk >/dev/null 2>&1; then
  real_awk="$(command -v gawk)"
  awk_flags=("--lint")
fi
if [[ -z "$real_awk" ]]; then
  echo "missing real awk" >&2
  exit 127
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"

limit=8000
max_len="$(wc -L < "$tmp" | tr -d '[:space:]')"
if [[ -n "$max_len" ]] && [[ "$max_len" -gt "$limit" ]]; then
  # Behave like a truncating awk: produce no output so callers fail to find matches.
  exit 0
fi

exec "$real_awk" "\${awk_flags[@]}" "$@" "$tmp"
`,
    'utf8',
  );
  await chmod(awkWrapperPath, 0o755);

  const curlStubPath = join(binDir, 'curl');
  await writeFile(
    curlStubPath,
    `#!/usr/bin/env bash
set -euo pipefail

# Minimal curl stub used by installer tests.
# - For metadata calls (no -o), return a pretty-printed JSON blob with enough padding to exceed the
#   wrapper-awk's max line-length limit *only if the installer collapses whitespace*.
# - For archive downloads, write an empty file (checksum mismatch).
# - For checksums downloads, write an entry with the correct filename but a mismatching checksum.
out=""
url=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" = "-o" ]]; then
    j=$((i+1))
    out="\${!j}"
    continue
  fi
  case "\${!i}" in
    http://*|https://*) url="\${!i}" ;;
  esac
done
if [[ -n "$out" ]]; then
  if [[ "$url" == *"checksums-happier-v0.1.0-preview.1.txt" ]]; then
    # Wrong checksum on purpose; should trigger "Checksum verification failed." later.
    printf '%s  %s\n' "0000000000000000000000000000000000000000000000000000000000000000" "happier-v0.1.0-preview.1-linux-x64.tar.gz" > "$out"
    exit 0
  fi
  : > "$out"
  exit 0
fi

cat <<'JSON_HEAD'
{
  "assets": [
    {
      "name": "happier-v0.1.0-preview.1-linux-x64.tar.gz",
      "browser_download_url": "https://example.test/happier-v0.1.0-preview.1-linux-x64.tar.gz"
    },
    {
      "name": "checksums-happier-v0.1.0-preview.1.txt",
      "browser_download_url": "https://example.test/checksums-happier-v0.1.0-preview.1.txt"
    },
    {
      "name": "checksums-happier-v0.1.0-preview.1.txt.minisig",
      "browser_download_url": "https://example.test/checksums-happier-v0.1.0-preview.1.txt.minisig"
    }
  ],
  "pad": [
JSON_HEAD

# Produce many small lines so the JSON becomes *large* but doesn't contain any single long line.
for i in $(seq 1 4000); do
  if [[ "$i" -eq 4000 ]]; then
    printf '    "p%s"\n' "$i"
  else
    printf '    "p%s",\n' "$i"
  fi
done
cat <<'JSON_TAIL'
  ]
}
JSON_TAIL
`,
    'utf8',
  );
  await chmod(curlStubPath, 0o755);

  const installerPath = join(repoRoot, 'scripts', 'release', 'installers', 'install.sh');
  const env = {
    ...process.env,
    PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HAPPIER_CHANNEL: 'preview',
    HAPPIER_PRODUCT: 'cli',
    HAPPIER_INSTALL_VERSION: '0.1.0-preview.1',
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: outBinDir,
    HAPPIER_NO_PATH_UPDATE: '1',
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  };

  const res = spawnSync('bash', [installerPath], { env, encoding: 'utf8' });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');
  const combined = `${stdout}\n${stderr}`;

  assert.notEqual(res.status, 0, `expected non-zero exit:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
  assert.doesNotMatch(combined, /Unable to locate release assets/i, `unexpected asset lookup failure:\n${combined}`);
  assert.match(combined, /Checksum verification failed/i, `expected checksum failure after parsing assets:\n${combined}`);
  assert.doesNotMatch(combined, /escape sequence.*not a known escape sequence/i);

  await rm(root, { recursive: true, force: true });
});

for (const scenario of [
  { channel: 'preview', product: 'cli', alias: false },
  { channel: 'preview', product: 'cli', alias: true },
  { channel: 'stable', product: 'cli', alias: true },
  { channel: 'stable', product: 'cli', alias: true, exact: true },
  { channel: 'stable', product: 'server', alias: true, exact: true },
  { channel: 'stable', product: 'stack', alias: true, exact: true },
]) {
test(`install.sh compact release lookup: ${scenario.product}/${scenario.channel}, alias=${scenario.alias}, exact=${Boolean(scenario.exact)}`, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'happier-installer-compact-asset-lookup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binDir = join(root, 'bin');
  const installDir = join(root, 'install');
  const outBinDir = join(root, 'out-bin');
  await mkdir(binDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(outBinDir, { recursive: true });

  const unameStubPath = join(binDir, 'uname');
  await writeFile(
    unameStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "-s" ]]; then
  echo Darwin
  exit 0
fi
if [[ "$1" = "-m" ]]; then
  echo arm64
  exit 0
fi
echo Darwin
`,
    'utf8',
  );
  await chmod(unameStubPath, 0o755);

  const version = scenario.channel === 'preview' ? '0.2.2-preview.1775586717.26498' : '0.2.2';
  const prefix = scenario.product === 'server' ? 'happier-server' : scenario.product === 'stack' ? 'hstack' : 'happier';
  const checksumAssetName = `${prefix}-v${version}-darwin-arm64.tar.gz`;
  const assetName = scenario.alias ? `${prefix}-darwin-arm64.tar.gz` : checksumAssetName;
  const checksumsName = `checksums-${prefix}-v${version}.txt`;
  const unrelatedSignatureName = `checksums-${prefix}-v${scenario.channel === 'preview' ? '9.9.9-preview.999' : '9.9.9'}.txt.minisig`;
  const requestLog = join(root, 'requests.log');
  const compactReleaseJson = JSON.stringify({
    assets: [
      {
        name: 'darwin-arm64.json',
        browser_download_url: 'https://example.test/darwin-arm64.json',
      },
      {
        name: assetName,
        browser_download_url: `https://example.test/${assetName}`,
      },
      ...(scenario.alias ? [{
        name: checksumAssetName,
        browser_download_url: `https://example.test/${checksumAssetName}`,
      }] : []),
      {
        name: checksumsName,
        browser_download_url: `https://example.test/${checksumsName}`,
      },
      {
        name: `${checksumsName}.minisig`,
        browser_download_url: `https://example.test/${checksumsName}.minisig`,
      },
      {
        name: unrelatedSignatureName,
        browser_download_url: 'https://example.test/wrong-signature',
      },
    ],
  });

  const curlStubPath = join(binDir, 'curl');
  await writeFile(
    curlStubPath,
    `#!/usr/bin/env bash
set -euo pipefail

out=""
url=""
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" = "-o" ]]; then
    j=$((i+1))
    out="\${!j}"
    continue
  fi
  case "\${!i}" in
    http://*|https://*) url="\${!i}" ;;
  esac
done
printf '%s\\n' "$url" >> "$HAPPIER_TEST_REQUEST_LOG"
if [[ -n "$out" ]]; then
  if [[ "$url" == *"${checksumsName}" ]]; then
    printf '%s  %s\\n' "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" "${checksumAssetName}.bak" > "$out"
    printf '%s  %s\\n' "0000000000000000000000000000000000000000000000000000000000000000" "${checksumAssetName}" >> "$out"
    exit 0
  fi
  : > "$out"
  exit 0
fi

printf '%s' '${compactReleaseJson}'
`,
    'utf8',
  );
  await chmod(curlStubPath, 0o755);

  const installerPath = join(repoRoot, 'scripts', 'release', 'installers', 'install.sh');
  const env = {
    ...process.env,
    PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HAPPIER_CHANNEL: scenario.channel,
    HAPPIER_PRODUCT: scenario.product,
    HAPPIER_INSTALL_VERSION: scenario.exact ? version : '',
    HAPPIER_TEST_REQUEST_LOG: requestLog,
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: outBinDir,
    HAPPIER_NO_PATH_UPDATE: '1',
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  };

  const res = spawnSync('bash', [installerPath], { env, encoding: 'utf8' });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');
  const combined = `${stdout}\n${stderr}`;

  assert.notEqual(res.status, 0, `expected non-zero exit:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
  assert.doesNotMatch(combined, /Unable to locate release assets/i, `unexpected asset lookup failure:\n${combined}`);
  assert.match(combined, /Checksum verification failed/i, `expected checksum failure after parsing compact assets:\n${combined}`);
  assert.ok(combined.includes(`Expected SHA-256: ${'0'.repeat(64)}`), 'checksum lookup must match the exact immutable archive name');
  const requests = (await readFile(requestLog, 'utf8')).trim().split('\n');
  const expectedTag = scenario.exact ? `${scenario.product}-v${version}` : `${scenario.product}-${scenario.channel}`;
  assert.equal(requests[0], `https://api.github.com/repos/happier-dev/happier/releases/tags/${expectedTag}`);
  assert.deepEqual(requests.slice(1), [
    `https://example.test/${scenario.alias && !scenario.exact ? assetName : checksumAssetName}`,
    `https://example.test/${checksumsName}`,
    `https://example.test/${checksumsName}.minisig`,
  ]);
});
}

test('install.sh --version semver-sorts rolling remote release assets instead of trusting API order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-installer-remote-asset-order-'));
  const binDir = join(root, 'bin');
  const installDir = join(root, 'install');
  const outBinDir = join(root, 'out-bin');
  await mkdir(binDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(outBinDir, { recursive: true });

  const unameStubPath = join(binDir, 'uname');
  await writeFile(
    unameStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "-s" ]]; then
  echo Linux
  exit 0
fi
if [[ "$1" = "-m" ]]; then
  echo x86_64
  exit 0
fi
echo Linux
`,
    'utf8',
  );
  await chmod(unameStubPath, 0o755);

  const newerVersion = '1.2.3-preview.42';
  const olderVersion = '1.2.3-preview.7';
  const curlStubPath = join(binDir, 'curl');
  await writeFile(
    curlStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
cat <<'JSON'
{
  "assets": [
    {
      "name": "happier-v${newerVersion}-linux-x64.tar.gz",
      "browser_download_url": "https://example.test/happier-v${newerVersion}-linux-x64.tar.gz"
    },
    {
      "name": "happier-v${olderVersion}-linux-x64.tar.gz",
      "browser_download_url": "https://example.test/happier-v${olderVersion}-linux-x64.tar.gz"
    },
    {
      "name": "checksums-happier-v${newerVersion}.txt",
      "browser_download_url": "https://example.test/checksums-happier-v${newerVersion}.txt"
    },
    {
      "name": "checksums-happier-v${olderVersion}.txt",
      "browser_download_url": "https://example.test/checksums-happier-v${olderVersion}.txt"
    }
  ]
}
JSON
`,
    'utf8',
  );
  await chmod(curlStubPath, 0o755);

  const installerPath = join(repoRoot, 'scripts', 'release', 'installers', 'install.sh');
  const env = {
    ...process.env,
    PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HAPPIER_CHANNEL: 'preview',
    HAPPIER_PRODUCT: 'cli',
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: outBinDir,
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  };

  const res = spawnSync('bash', [installerPath, '--version'], { env, encoding: 'utf8' });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');

  assert.equal(res.status, 0, `expected remote-assets version check to succeed:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
  assert.match(stdout, /channel:\s+preview/i);
  assert.match(stdout, /version:\s+1\.2\.3-preview\.42/i);
  assert.doesNotMatch(stdout, /version:\s+1\.2\.3-preview\.7/i);

  await rm(root, { recursive: true, force: true });
});

test('install.sh --version orders strict-prefix prerelease identifiers for preview remote rolling assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-installer-remote-prerelease-prefix-'));
  const binDir = join(root, 'bin');
  const installDir = join(root, 'install');
  const outBinDir = join(root, 'out-bin');
  await mkdir(binDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(outBinDir, { recursive: true });

  const unameStubPath = join(binDir, 'uname');
  await writeFile(
    unameStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "-s" ]]; then
  echo Linux
  exit 0
fi
if [[ "$1" = "-m" ]]; then
  echo x86_64
  exit 0
fi
echo Linux
`,
    'utf8',
  );
  await chmod(unameStubPath, 0o755);

  const newerVersion = '1.0.0-preview.alpha.1';
  const olderVersion = '1.0.0-preview.alpha';
  const curlStubPath = join(binDir, 'curl');
  await writeFile(
    curlStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
cat <<'JSON'
{
  "assets": [
    {
      "name": "happier-v${newerVersion}-linux-x64.tar.gz",
      "browser_download_url": "https://example.test/happier-v${newerVersion}-linux-x64.tar.gz"
    },
    {
      "name": "happier-v${olderVersion}-linux-x64.tar.gz",
      "browser_download_url": "https://example.test/happier-v${olderVersion}-linux-x64.tar.gz"
    },
    {
      "name": "checksums-happier-v${newerVersion}.txt",
      "browser_download_url": "https://example.test/checksums-happier-v${newerVersion}.txt"
    },
    {
      "name": "checksums-happier-v${olderVersion}.txt",
      "browser_download_url": "https://example.test/checksums-happier-v${olderVersion}.txt"
    }
  ]
}
JSON
`,
    'utf8',
  );
  await chmod(curlStubPath, 0o755);

  const installerPath = join(repoRoot, 'scripts', 'release', 'installers', 'install.sh');
  const env = {
    ...process.env,
    PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HAPPIER_CHANNEL: 'preview',
    HAPPIER_PRODUCT: 'cli',
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: outBinDir,
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  };

  const res = spawnSync('bash', [installerPath, '--version'], { env, encoding: 'utf8' });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');

  assert.equal(res.status, 0, `expected remote-assets version check to succeed:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
  assert.match(stdout, /version:\s+1\.0\.0-preview\.alpha\.1/i);
  assert.doesNotMatch(stdout, /version:\s+1\.0\.0-preview\.alpha$/im);

  await rm(root, { recursive: true, force: true });
});

test('install.sh --version reports a missing stable asset without shell variable crashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-installer-missing-stable-asset-'));
  const binDir = join(root, 'bin');
  const installDir = join(root, 'install');
  const outBinDir = join(root, 'out-bin');
  await mkdir(binDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(outBinDir, { recursive: true });

  const unameStubPath = join(binDir, 'uname');
  await writeFile(
    unameStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = "-s" ]]; then
  echo Linux
  exit 0
fi
if [[ "$1" = "-m" ]]; then
  echo x86_64
  exit 0
fi
echo Linux
`,
    'utf8',
  );
  await chmod(unameStubPath, 0o755);

  const curlStubPath = join(binDir, 'curl');
  await writeFile(
    curlStubPath,
    `#!/usr/bin/env bash
set -euo pipefail
cat <<'JSON'
{
  "assets": [
    {
      "name": "checksums-happier-v1.2.3.txt",
      "browser_download_url": "https://example.test/checksums-happier-v1.2.3.txt"
    }
  ]
}
JSON
`,
    'utf8',
  );
  await chmod(curlStubPath, 0o755);

  const installerPath = join(repoRoot, 'scripts', 'release', 'installers', 'install.sh');
  const env = {
    ...process.env,
    PATH: `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HAPPIER_CHANNEL: 'stable',
    HAPPIER_PRODUCT: 'cli',
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: outBinDir,
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_GITHUB_TOKEN: '',
    GITHUB_TOKEN: '',
  };

  const res = spawnSync('bash', [installerPath, '--version'], { env, encoding: 'utf8' });
  const stdout = String(res.stdout ?? '');
  const stderr = String(res.stderr ?? '');

  assert.equal(res.status, 1, `expected missing stable asset to fail cleanly:\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
  assert.match(stderr, /Unable to locate release assets for linux-x64/i);
  assert.doesNotMatch(stderr, /unbound variable/i);

  await rm(root, { recursive: true, force: true });
});
