import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlanetFrame } from '../../packages/brand/planet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const installerPath = join(resolve(here, '..', '..'), 'scripts', 'release', 'installers', 'install.ps1');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name} {`);
  assert.notEqual(start, -1, `expected ${name} to exist`);
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('install.ps1 presents the branded planet header with the same generated planet as install.sh', async () => {
  const [source, bashSource] = await Promise.all([
    readFile(installerPath, 'utf8'),
    readFile(join(dirname(installerPath), 'install.sh'), 'utf8'),
  ]);
  const header = extractFunction(source, 'Write-InstallerHeader');

  const powershellRowsBlock = header.match(/\$rows\s*=\s*@\(([\s\S]*?)\n\s*\)/)?.[1];
  const bashRowsBlock = bashSource.match(/HAPPIER_INSTALLER_ART_ROWS=\(([\s\S]*?)\n\)/)?.[1];
  assert.ok(powershellRowsBlock, 'expected PowerShell artwork rows');
  assert.ok(bashRowsBlock, 'expected Bash artwork rows');
  // PowerShell 5.1 may decode a downloaded script with a legacy code page, so the
  // generated planet spells every Braille cell as a code point and stays ASCII.
  const planetBlock = header.match(/# BEGIN GENERATED PLANET[\s\S]*?# END GENERATED PLANET/)?.[0] ?? '';
  assert.match(planetBlock, /\[char\]0x28[0-9a-f]{2}/);
  assert.doesNotMatch(planetBlock, /[^\x00-\x7f]/u);
  const powershellRows = [...powershellRowsBlock.matchAll(/^\s*"([^"]*)",?$/gm)]
    .map((match) => match[1].replace(/\$\(\[char\]0x([0-9a-f]{4})\)/gu, (_, code) => String.fromCharCode(parseInt(code, 16))));
  const bashRows = [...bashRowsBlock.matchAll(/^\s*'([^']*)'$/gm)].map((match) => match[1]);
  const expectedRows = createPlanetFrame({ columns: 28 })
    .map((row) => row.map((cell) => cell?.ch ?? ' ').join(''));
  assert.deepEqual(powershellRows, expectedRows);
  assert.deepEqual(powershellRows, bashRows, 'expected PowerShell and Bash installers to share one visual identity');
  assert.ok(powershellRows.every((row) => [...row].length === 28), 'expected labels to start at one fixed column');
  assert.match(header, /Happier/);
  assert.match(header, /Start coding anywhere\. Continue anywhere\./);
  assert.match(header, /Download -> Verify -> Install/);
  assert.match(header, /Write-Host "Happier"/, 'expected a text-only header fallback');
  assert.match(header, /\[1m/);
  assert.doesNotMatch(header, /Dark(?:Red|Blue|Magenta|Cyan|Yellow)/, 'expected readable colors on dark terminals');

  // The legacy console host has no Braille glyphs; only hosts that can draw them get the art.
  assert.match(header, /-not \(Test-InstallerRichHeaderAvailable\)/);
  assert.match(header, /-not \(Test-InstallerBrailleArtAvailable\)/);
  const braille = extractFunction(source, 'Test-InstallerBrailleArtAvailable');
  assert.match(braille, /\$env:WT_SESSION/);
  assert.match(braille, /\$env:TERM_PROGRAM/);

  const richOutput = extractFunction(source, 'Test-InstallerRichHeaderAvailable');
  assert.match(richOutput, /\[Console\]::IsOutputRedirected/);
  assert.match(richOutput, /\$env:TERM\s*-eq\s*"dumb"/i);
  assert.match(richOutput, /WindowWidth\s*-ge\s*76/);
  assert.match(richOutput, /WindowHeight\s*-ge\s*16/);
  const bashFitCheck = bashSource.match(/installer_terminal_fits_header\(\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(bashFitCheck, 'expected Bash terminal-size owner');
  assert.match(bashFitCheck, /\$\{columns\}"\s*-ge\s*76/);
  assert.match(bashFitCheck, /\$\{rows\}"\s*-ge\s*16/);

  // The header opens the install run: after the early `-Run` shortcut for an
  // existing install, before release metadata is fetched.
  const headerCallIndex = source.search(/^Write-InstallerHeader$/m);
  const shortcutIndex = source.indexOf('if ($Run -and -not $SetupRelay -and ($existing = Resolve-InstalledCliInvoker))');
  const metadataIndex = source.indexOf('Fetching $tag release metadata');
  assert.ok(shortcutIndex > 0 && shortcutIndex < headerCallIndex, 'expected the existing-install shortcut to stay header-free');
  assert.ok(headerCallIndex < metadataIndex, 'expected the header before release metadata is fetched');

  const webRequest = extractFunction(source, 'Invoke-InstallerWebRequestWithRetry');
  assert.match(webRequest, /Test-InstallerAnimationDisabled/);
  assert.match(webRequest, /-not \(Test-InstallerRichHeaderAvailable\)/);
  assert.match(webRequest, /\$ProgressPreference\s*=\s*"SilentlyContinue"/);
  assert.match(webRequest, /finally\s*\{[\s\S]*\$ProgressPreference\s*=\s*\$previousProgressPreference/);
  const animationDisabled = extractFunction(source, 'Test-InstallerAnimationDisabled');
  assert.match(animationDisabled, /HAPPIER_NO_ANIMATION/);
});

test('install.ps1 scopes the welcome marker to the setup child only', async () => {
  const source = await readFile(installerPath, 'utf8');
  const setup = extractFunction(source, 'Invoke-InstallerSetupCommand');

  assert.match(setup, /\$script:InstallerHeaderShown/);
  assert.match(setup, /\$env:HAPPIER_INSTALLER_WELCOME_SHOWN\s*=\s*"1"/);
  assert.match(setup, /finally\s*\{/);
  assert.match(setup, /Remove-Item Env:HAPPIER_INSTALLER_WELCOME_SHOWN/);
  assert.match(setup, /\$env:HAPPIER_INSTALLER_WELCOME_SHOWN\s*=\s*\$previousValue/);

  const postInstall = extractFunction(source, 'Invoke-PostInstallAction');
  assert.match(postInstall, /if\s*\(\$runValue\s*-eq\s*"setup"\)[\s\S]*Invoke-InstallerSetupCommand/);
});
