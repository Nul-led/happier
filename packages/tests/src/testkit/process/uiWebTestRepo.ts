import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Export/Metro process boundaries are stubbed by their callers, but filesystem
// cache keys stay real and must not depend on a developer's whole checkout.
export async function createUiWebTestRepo(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'happier-uiweb-repo-'));
  const uiDir = join(rootDir, 'apps', 'ui');
  await mkdir(join(uiDir, 'sources'), { recursive: true });
  const expoBinDir = join(uiDir, 'node_modules', 'expo', 'bin');
  await mkdir(expoBinDir, { recursive: true });
  // The owner validates entrypoint existence before reaching the process stub.
  await writeFile(join(expoBinDir, 'cli'), 'throw new Error("fixture Expo must run through the process boundary");\n');
  await mkdir(join(rootDir, '.project', 'tmp'), { recursive: true });
  await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: '@happier-dev/ui', private: true }));
  await writeFile(join(uiDir, 'index.ts'), 'export {};\n');
  return rootDir;
}
