import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path)
      : /\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path) ? [path] : [];
  });
}
function specifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]);
}
describe('session core package boundary', () => {
  it('contains only headless domain owners and approved dependencies', () => {
    const root = fileURLToPath(new URL('.', import.meta.url));
    const allowed = /^(?:zod(?:\/|$)|@happier-dev\/(?:protocol|agents)(?:\/|$)|\.{1,2}\/)/;
    const offenders = sourceFiles(root).flatMap((file) => specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => !allowed.test(specifier)).map((specifier) => `${relative(root, file)} → ${specifier}`));
    expect(offenders).toEqual([]);
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).filter((name) => !['zod', '@happier-dev/protocol', '@happier-dev/agents'].includes(name))).toEqual([]);
  });
});
